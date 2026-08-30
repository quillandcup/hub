import { createHash } from "crypto";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { isMembershipOffer, trialEndDate } from "@/lib/membership";
import { buildMembershipStints, fetchStripeTrialInfoByKajabiCustomerId } from "@/lib/kajabi/membership-history";
import { computeMemberTenure, computeActiveDays, type HiatusWindow } from "@/lib/member-tenure";
import { NextRequest, NextResponse, after } from "next/server";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";
import type { SupabaseClient } from "@supabase/supabase-js";

const KAJABI_CDN = "https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/"

function toKajabiPhotoUrl(path: string | null | undefined, email: string): string {
  if (path) {
    if (path.startsWith("http://") || path.startsWith("https://")) return path
    return KAJABI_CDN + path
  }
  // No custom Kajabi avatar — try Gravatar; d=404 means 404 if no account (onError → initials)
  const hash = createHash("md5").update(email.toLowerCase().trim()).digest("hex")
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=200`
}

function toSocialUrl(base: string, handle: string | null | undefined): string | null {
  if (!handle) return null
  const trimmed = handle.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
  // Strip leading @, /, spaces; strip trailing /
  const clean = trimmed.replace(/^[@/\s]+/, "").replace(/\/+$/, "")
  if (!clean) return null
  return `${base}/${clean}`
}

// Extend timeout — member processing itself is fast (~10s), but we kick off
// background attendance reprocessing via after() which needs the remainder.
export const maxDuration = 300;

/**
 * Process Bronze layer data into Silver layer (members)
 *
 * NEW ARCHITECTURE: Follows medallion pattern
 *
 * Bronze sources:
 * 1. kajabi_contacts - All people in Kajabi (raw)
 * 2. kajabi_customers - People who made purchases (raw)
 * 3. kajabi_purchases - Purchase/subscription records (raw)
 * 4. kajabi_offers - Offer/product definitions (raw)
 * 5. staff - Team members
 *
 * This endpoint:
 * 1. Reads latest Bronze data (contacts, purchases, offers)
 * 2. Joins them to determine member status and trial flag
 * 3. Applies business logic
 * 4. Regenerates members table (UPSERT pattern to preserve UUIDs)
 */
// Fetches every row from a Bronze table, paginating past Supabase's default
// 1000-row cap so large tables (e.g. kajabi_contacts, kajabi_purchases) don't
// get silently truncated. See CLAUDE.md "Database Query Limits".
async function fetchAllBronzeRows(
  supabase: SupabaseClient,
  table: string,
  columns: string = "*"
): Promise<any[]> {
  const BATCH_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .schema('bronze')
      .from(table)
      .select(columns)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw error;

    if (batch && batch.length > 0) {
      allRows = allRows.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

// Same pagination as fetchAllBronzeRows, for public-schema (Local/Silver)
// tables that can also grow past 1000 rows — used here for `members` and
// `member_status_overrides`.
async function fetchAllPublicRows(
  supabase: SupabaseClient,
  table: string,
  columns: string = "*",
  filter?: (query: any) => any
): Promise<any[]> {
  const BATCH_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(columns);
    if (filter) query = filter(query);
    const { data: batch, error } = await query.range(offset, offset + BATCH_SIZE - 1);

    if (error) throw error;

    if (batch && batch.length > 0) {
      allRows = allRows.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    // STEP 1: Load Bronze data + Local data.
    // kajabi_contacts, kajabi_customers, kajabi_purchases, and kajabi_offers can each
    // exceed Supabase's default 1000-row cap, so they're paginated in parallel loops.
    const [
      contacts,
      customers,
      purchases,
      offers,
      { data: staffMembers, error: staffError },
      { data: emailAliases, error: aliasesError },
      { data: stripeCustomers, error: stripeError },
      existingMembers,
      hiatusOverrides,
      joinDateOverrides,
    ] = await Promise.all([
      fetchAllBronzeRows(supabase, "kajabi_contacts"),
      fetchAllBronzeRows(supabase, "kajabi_customers"),
      fetchAllBronzeRows(supabase, "kajabi_purchases"),
      fetchAllBronzeRows(supabase, "kajabi_offers"),
      supabase.from("staff").select("*"),
      supabase.from("member_email_aliases").select("*"),
      supabase.schema('bronze').from("stripe_customers").select("stripe_customer_id, email"),
      fetchAllPublicRows(supabase, "members", "id, email"),
      fetchAllPublicRows(supabase, "member_status_overrides", "member_id, starts_at, expires_at", (q) =>
        q.eq("override_type", "hiatus")
      ),
      fetchAllPublicRows(supabase, "member_join_date_overrides", "member_id, first_joined_at"),
    ]);

    if (staffError) throw staffError;
    if (aliasesError) throw aliasesError;
    if (stripeError) throw stripeError;

    // Stripe subscriptions' real trial-conversion dates, keyed by Kajabi
    // customer ID — see lib/kajabi/membership-history.ts for why this
    // matters (Kajabi's created_at_kajabi is when a trial *started*, not
    // when it converted to a real transaction).
    const stripeTrialInfoByKajabiCustomerId = await fetchStripeTrialInfoByKajabiCustomerId(
      supabase,
      [...new Set((purchases || []).map((p: any) => p.kajabi_customer_id).filter(Boolean))]
    );

    console.log('[DEBUG] Bronze sources:', {
      contacts_count: contacts?.length || 0,
      customers_count: customers?.length || 0,
      purchases_count: purchases?.length || 0,
      offers_count: offers?.length || 0,
      staff_count: staffMembers?.length || 0,
      email_aliases_count: emailAliases?.length || 0,
      stripe_customers_count: stripeCustomers?.length || 0,
      existing_members_count: existingMembers?.length || 0,
      hiatus_overrides_count: hiatusOverrides?.length || 0,
      join_date_overrides_count: joinDateOverrides?.length || 0,
    });

    // STEP 2: Build lookup maps

    // Email alias resolution
    const aliasMap = new Map<string, string>();
    if (emailAliases && emailAliases.length > 0) {
      for (const alias of emailAliases) {
        aliasMap.set(alias.alias_email.toLowerCase(), alias.canonical_email.toLowerCase());
      }
    }

    function resolveEmail(email: string): string {
      const normalized = email.toLowerCase();
      return aliasMap.get(normalized) || normalized;
    }

    // Hiatus windows for tenure calculations (lib/member-tenure.ts): resolve
    // member_status_overrides.member_id (our internal UUID) to the email
    // this run's tenure computation is keyed by, via the members table.
    const emailByMemberId = new Map<string, string>();
    for (const m of existingMembers || []) {
      if (m.email) emailByMemberId.set(m.id, resolveEmail(m.email));
    }
    const hiatusWindowsByEmail = new Map<string, HiatusWindow[]>();
    for (const override of hiatusOverrides || []) {
      const email = emailByMemberId.get(override.member_id);
      if (!email) continue;
      const windows = hiatusWindowsByEmail.get(email) ?? [];
      windows.push({ startsAt: override.starts_at, endsAt: override.expires_at });
      hiatusWindowsByEmail.set(email, windows);
    }

    // Legacy join-date corrections (member_join_date_overrides — see that
    // migration's comment): resolved to email the same way as hiatus windows
    // above, so they survive re-running this reprocess.
    const joinDateOverrideByEmail = new Map<string, string>();
    for (const override of joinDateOverrides || []) {
      const email = emailByMemberId.get(override.member_id);
      if (!email) continue;
      joinDateOverrideByEmail.set(email, override.first_joined_at);
    }

    // Offer lookup by ID
    const offerMap = new Map<string, any>();
    if (offers && offers.length > 0) {
      for (const offer of offers) {
        offerMap.set(offer.kajabi_offer_id, offer);
      }
    }

    // Customer lookup by ID (for joining purchases → customer email)
    const customerMap = new Map<string, any>();
    if (customers && customers.length > 0) {
      for (const customer of customers) {
        customerMap.set(customer.kajabi_customer_id, customer);
      }
    }

    // Profile field lookup: email → customer (for avatar, bio, socials)
    const customerByEmail = new Map<string, any>();
    if (customers && customers.length > 0) {
      for (const customer of customers) {
        const email = resolveEmail(customer.email);
        const existing = customerByEmail.get(email);
        if (!existing || customer.updated_at_kajabi > existing.updated_at_kajabi) {
          customerByEmail.set(email, customer);
        }
      }
    }

    // Stripe customer ID lookup: email → stripe_customer_id
    const stripeIdByEmail = new Map<string, string>();
    if (stripeCustomers && stripeCustomers.length > 0) {
      for (const sc of stripeCustomers) {
        if (sc.email && sc.stripe_customer_id) {
          stripeIdByEmail.set(resolveEmail(sc.email), sc.stripe_customer_id);
        }
      }
    }

    // Purchases by email (join via customer)
    const purchasesByEmail = new Map<string, any[]>();
    if (purchases && purchases.length > 0) {
      for (const purchase of purchases) {
        const customer = customerMap.get(purchase.kajabi_customer_id);
        if (customer?.email) {
          const email = resolveEmail(customer.email);
          if (!purchasesByEmail.has(email)) {
            purchasesByEmail.set(email, []);
          }
          purchasesByEmail.get(email)!.push(purchase);
        }
      }
    }

    // STEP 3: Process Kajabi contacts into members
    const kajabiMembers = [];

    if (contacts && contacts.length > 0) {
      for (const contact of contacts) {
        const email = resolveEmail(contact.email);
        const contactPurchases = purchasesByEmail.get(email) || [];

        // Find active SUBSCRIPTION purchase (Quill & Cup Membership product)
        // Active = has an active purchase for a subscription offer
        const activePurchase = contactPurchases.find(p => {
          if (p.status !== 'active') return false;
          const offer = offerMap.get(p.kajabi_offer_id);
          // Check if offer is a subscription (data.attributes.subscription === true)
          return offer?.data?.attributes?.subscription === true;
        });

        let plan: string | null = null;

        if (activePurchase) {
          const offer = offerMap.get(activePurchase.kajabi_offer_id);
          if (offer) {
            // Determine plan from offer name
            const offerName = offer.name || '';
            if (isMembershipOffer(offerName)) {
              plan = 'Membership';
            } else if (offerName) {
              plan = 'Other';
            }
          }
        }

        // Determine member status.
        // Once a purchase survives past its trial window (or never had one), it
        // counts as a real subscription — cancelling after that always means
        // "cancelled", never falls back to "lead". A purchase cancelled *during*
        // its trial window never converted, so it doesn't count toward
        // "cancelled" — that person is still a "lead".
        let status: "lead" | "active" | "on_hiatus" | "cancelled";
        if (activePurchase) {
          status = "active";
        } else {
          const hadRealSubscription = contactPurchases.some(p => {
            const offer = offerMap.get(p.kajabi_offer_id);
            if (offer?.data?.attributes?.subscription !== true) return false;
            const trialEnd = trialEndDate(p, offer);
            if (!trialEnd) return true; // no trial at all — billed from day one
            if (!p.deactivated_at) return true; // can't tell when it ended; assume real rather than misclassify a former member as a lead
            return new Date(p.deactivated_at) > trialEnd; // survived past the trial window = was actually billed
          });
          status = hadRealSubscription ? "cancelled" : "lead";
        }

        // Skip if missing required fields
        if (!contact.created_at_kajabi) {
          console.warn(`Skipping contact ${email}: missing created_at`);
          continue;
        }

        // Use email as name fallback
        const name = contact.name || email;
        if (!contact.name) {
          console.warn(`Contact ${email}: using email as name (no name in Kajabi)`);
        }

        const customer = customerByEmail.get(email);
        const attrs = customer?.data?.attributes;

        const stints = buildMembershipStints(contactPurchases, offerMap, stripeTrialInfoByKajabiCustomerId);
        const tenure = computeMemberTenure(stints, hiatusWindowsByEmail.get(email) ?? [], new Date());

        // A legacy join-date override always wins over the computed value —
        // it exists specifically because Kajabi has no record of the true
        // date. If tenure didn't independently detect a rejoin (most-recent
        // still equals the un-overridden first-joined), pull most-recent
        // forward too — they've been continuously active since the real
        // join date, not just since Kajabi's earliest record of them.
        const joinDateOverride = joinDateOverrideByEmail.get(email);
        const firstJoinedAt = joinDateOverride ?? tenure.firstJoinedAt;
        const mostRecentJoinedAt =
          joinDateOverride && tenure.mostRecentJoinedAt === tenure.firstJoinedAt
            ? joinDateOverride
            : tenure.mostRecentJoinedAt;

        kajabiMembers.push({
          email,
          _originalEmail: contact.email.toLowerCase(),
          name,
          joined_at: contact.created_at_kajabi.split('T')[0],
          first_joined_at: firstJoinedAt,
          most_recent_joined_at: mostRecentJoinedAt,
          total_active_months: tenure.totalActiveMonths,
          status,
          plan,
          source: 'kajabi',
          staff_role: null,
          user_id: null,
          kajabi_id: contact.kajabi_contact_id,
          stripe_customer_id: stripeIdByEmail.get(email) ?? null,
          photo_url: toKajabiPhotoUrl(attrs?.avatar, email),
          bio: attrs?.public_bio || null,
          instagram_url: toSocialUrl("https://instagram.com", attrs?.socials?.instagram),
          facebook_url: toSocialUrl("https://facebook.com", attrs?.socials?.facebook),
          twitter_url: toSocialUrl("https://x.com", attrs?.socials?.twitter),
        });
      }
    }

    // STEP 4: Build staff lookup map
    const staffByEmail = new Map<string, any>();
    if (staffMembers && staffMembers.length > 0) {
      for (const staff of staffMembers) {
        staffByEmail.set(resolveEmail(staff.email), staff);
      }
    }

    // STEP 5: Merge Kajabi members with staff metadata
    // Staff members are always active — they work for the company regardless of subscription status.
    const membersByEmail = new Map<string, any>();

    // Process Kajabi members and enhance with staff data
    for (const member of kajabiMembers) {
      const staff = staffByEmail.get(member.email);

      if (staff) {
        member.staff_role = staff.role;
        member.user_id = staff.user_id;
        member.status = 'active'; // Staff are always active
        // Use staff hire date if earlier than Kajabi joined_at
        if (staff.hire_date && staff.hire_date < member.joined_at) {
          member.joined_at = staff.hire_date;
        }
        if (staff.hire_date && (!member.first_joined_at || staff.hire_date < member.first_joined_at)) {
          member.first_joined_at = staff.hire_date;
          if (!member.most_recent_joined_at) member.most_recent_joined_at = staff.hire_date;
        }
        // Mark as processed
        staffByEmail.delete(member.email);
      }

      const existing = membersByEmail.get(member.email);
      if (existing) {
        // Two Kajabi contacts resolved to the same canonical email (merged member).
        // Prefer the contact whose original email IS the canonical email — that's the
        // primary. The alias contact's data (name, kajabi_id, etc.) must not overwrite it.
        const existingIsCanonical = existing._originalEmail === member.email;
        const incomingIsCanonical = member._originalEmail === member.email;
        if (existingIsCanonical && !incomingIsCanonical) {
          // Keep existing primary; skip this alias contact
          continue;
        }
      }

      membersByEmail.set(member.email, member);
    }

    // Add staff members who have NO Kajabi record — always active
    for (const [email, staff] of staffByEmail) {
      const staffJoinedAt = staff.hire_date || '2020-01-01';
      const staffHiatusWindows = hiatusWindowsByEmail.get(email) ?? [];
      const now = new Date();
      membersByEmail.set(email, {
        email,
        name: staff.name,
        joined_at: staffJoinedAt,
        first_joined_at: staffJoinedAt,
        most_recent_joined_at: staffJoinedAt,
        total_active_months: Math.floor(
          computeActiveDays(staffJoinedAt, now.toISOString(), staffHiatusWindows, now) / 30
        ),
        status: 'active' as const,
        plan: null,
        source: 'staff',
        staff_role: staff.role,
        user_id: staff.user_id,
        kajabi_id: null,
        stripe_customer_id: null,
        photo_url: null,
        bio: null,
        instagram_url: null,
        facebook_url: null,
        twitter_url: null,
      });
    }

    const allMembers = Array.from(membersByEmail.values());

    if (allMembers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No valid members to process",
        processed: 0,
      });
    }

    const staffCount = allMembers.filter(m => m.staff_role !== null).length;
    const staffWithPurchases = allMembers.filter(m => m.staff_role !== null && m.status === 'active').length;
    console.log(`Combined sources: ${kajabiMembers.length} Kajabi members, ${staffCount} staff (${staffWithPurchases} with active purchases) = ${allMembers.length} unique members`);

    // STEP 6: UPSERT to Silver layer (preserves UUIDs for existing members)
    console.log("Upserting members to Silver layer (preserving UUIDs)...");

    const { error: upsertError } = await supabase.rpc('reprocess_members_atomic', {
      new_data: allMembers,
    });

    if (upsertError) {
      console.error("Error upserting members:", upsertError);
      throw upsertError;
    }

    // After the response is sent, reprocess attendance for the last 90 days.
    // This ensures any newly-added or newly-matchable members get their historical
    // Zoom attendance records created — making "matched → no attendance record" impossible.
    const reprocessTo = new Date();
    const reprocessFrom = new Date(reprocessTo);
    reprocessFrom.setDate(reprocessFrom.getDate() - 90);
    after(async () => {
      try {
        await triggerAttendanceReprocessing({ from: reprocessFrom, to: reprocessTo });
      } catch (err) {
        console.error('Background attendance reprocessing failed after member change:', err);
      }
    });

    // Note: on_hiatus is always 0 here — hiatus/gift overrides are applied inside
    // reprocess_members_atomic (from member_status_overrides) after this snapshot
    // is taken, so this breakdown reflects pre-override Kajabi-derived status only.
    return NextResponse.json({
      success: true,
      processed: allMembers.length,
      statusBreakdown: {
        active: allMembers.filter((m) => m.status === "active").length,
        on_hiatus: allMembers.filter((m) => m.status === "on_hiatus").length,
        cancelled: allMembers.filter((m) => m.status === "cancelled").length,
        lead: allMembers.filter((m) => m.status === "lead").length,
      },
    });
  } catch (error: any) {
    console.error("Error processing members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process members" },
      { status: 500 }
    );
  }
}

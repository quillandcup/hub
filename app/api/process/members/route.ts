import { createHash } from "crypto";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { NextRequest, NextResponse, after } from "next/server";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";

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
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    // STEP 1: Load Bronze data + Local data
    const [
      { data: contacts, error: contactsError },
      { data: customers, error: customersError },
      { data: purchases, error: purchasesError },
      { data: offers, error: offersError },
      { data: staffMembers, error: staffError },
      { data: emailAliases, error: aliasesError },
      { data: stripeCustomers, error: stripeError }
    ] = await Promise.all([
      supabase.schema('bronze').from("kajabi_contacts").select("*"),
      supabase.schema('bronze').from("kajabi_customers").select("*"),
      supabase.schema('bronze').from("kajabi_purchases").select("*"),
      supabase.schema('bronze').from("kajabi_offers").select("*"),
      supabase.from("staff").select("*"),
      supabase.from("member_email_aliases").select("*"),
      supabase.schema('bronze').from("stripe_customers").select("stripe_customer_id, email")
    ]);

    if (contactsError) throw contactsError;
    if (customersError) throw customersError;
    if (purchasesError) throw purchasesError;
    if (offersError) throw offersError;
    if (staffError) throw staffError;
    if (aliasesError) throw aliasesError;
    if (stripeError) throw stripeError;

    console.log('[DEBUG] Bronze sources:', {
      contacts_count: contacts?.length || 0,
      customers_count: customers?.length || 0,
      purchases_count: purchases?.length || 0,
      offers_count: offers?.length || 0,
      staff_count: staffMembers?.length || 0,
      email_aliases_count: emailAliases?.length || 0,
      stripe_customers_count: stripeCustomers?.length || 0,
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

        // Determine if this is a trial user
        let isTrial = false;
        let plan: string | null = null;

        if (activePurchase) {
          const offer = offerMap.get(activePurchase.kajabi_offer_id);
          if (offer) {
            // Trial detection: offer has trial_period_days > 0
            isTrial = (offer.trial_period_days && offer.trial_period_days > 0) || false;

            // Determine plan from offer name
            const offerName = offer.name || '';
            if (MEMBERSHIP_PRODUCT_NAMES.some(n => offerName.includes(n)) || offerName.includes('Membership')) {
              plan = 'Membership';
            } else if (offerName.includes('BFF')) {
              plan = 'BFF';
            } else if (offerName) {
              plan = 'Other';
            }
          }
        }

        // Determine member status
        let status: "active" | "inactive" | "on_hiatus";
        if (activePurchase) {
          status = "active";
        } else if (contactPurchases.length > 0) {
          // Had purchases but none active subscription = canceled
          status = "inactive";
        } else {
          // Never purchased (leads, trial prospects) = inactive
          status = "inactive";
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

        kajabiMembers.push({
          email,
          _originalEmail: contact.email.toLowerCase(),
          name,
          joined_at: contact.created_at_kajabi.split('T')[0],
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
          _metadata: { isTrial }
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
      membersByEmail.set(email, {
        email,
        name: staff.name,
        joined_at: staff.hire_date || '2020-01-01',
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
        _metadata: { isTrial: false }
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

    return NextResponse.json({
      success: true,
      processed: allMembers.length,
      statusBreakdown: {
        active: allMembers.filter((m) => m.status === "active").length,
        on_hiatus: allMembers.filter((m) => m.status === "on_hiatus").length,
        inactive: allMembers.filter((m) => m.status === "inactive").length,
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

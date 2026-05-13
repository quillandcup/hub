import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for processing large batches of members
export const maxDuration = 60; // 60 seconds (max for Hobby tier)

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
  // Check authentication (supports both cookie-based and service role key)
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  } else {
    // Use cookie-based client for normal requests
    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // STEP 1: Load Bronze data + Local data
    const [
      { data: contacts, error: contactsError },
      { data: customers, error: customersError },
      { data: purchases, error: purchasesError },
      { data: offers, error: offersError },
      { data: staffMembers, error: staffError },
      { data: emailAliases, error: aliasesError }
    ] = await Promise.all([
      supabase.schema('bronze').from("kajabi_contacts").select("*"),
      supabase.schema('bronze').from("kajabi_customers").select("*"),
      supabase.schema('bronze').from("kajabi_purchases").select("*"),
      supabase.schema('bronze').from("kajabi_offers").select("*"),
      supabase.from("staff").select("*"),
      supabase.from("member_email_aliases").select("*")
    ]);

    if (contactsError) throw contactsError;
    if (customersError) throw customersError;
    if (purchasesError) throw purchasesError;
    if (offersError) throw offersError;
    if (staffError) throw staffError;
    if (aliasesError) throw aliasesError;

    console.log('[DEBUG] Bronze sources:', {
      contacts_count: contacts?.length || 0,
      customers_count: customers?.length || 0,
      purchases_count: purchases?.length || 0,
      offers_count: offers?.length || 0,
      staff_count: staffMembers?.length || 0,
      email_aliases_count: emailAliases?.length || 0,
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
            if (offerName.includes('Quill & Cup Membership') || offerName.includes('Membership')) {
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

        kajabiMembers.push({
          email,
          name,
          joined_at: contact.created_at_kajabi.split('T')[0], // Convert to date
          status,
          plan,
          source: 'kajabi',
          staff_role: null,
          user_id: null,
          kajabi_id: contact.kajabi_contact_id,
          stripe_customer_id: null, // Would need to map from Stripe if available
          // Store trial flag for future use
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
    // Staff are only "active" if they have an active Kajabi purchase
    const membersByEmail = new Map<string, any>();

    // Process Kajabi members and enhance with staff data
    for (const member of kajabiMembers) {
      const staff = staffByEmail.get(member.email);

      if (staff) {
        // Merge: keep Kajabi status (purchase-based), add staff metadata
        member.staff_role = staff.role;
        member.user_id = staff.user_id;
        // Use staff hire date if earlier than Kajabi joined_at
        if (staff.hire_date && staff.hire_date < member.joined_at) {
          member.joined_at = staff.hire_date;
        }
        // Mark as processed
        staffByEmail.delete(member.email);
      }

      membersByEmail.set(member.email, member);
    }

    // Add staff members who have NO Kajabi record (inactive by default)
    for (const [email, staff] of staffByEmail) {
      membersByEmail.set(email, {
        email,
        name: staff.name,
        joined_at: staff.hire_date || '2020-01-01',
        status: 'inactive' as const, // Staff without purchase = inactive
        plan: null,
        source: 'staff',
        staff_role: staff.role,
        user_id: staff.user_id,
        kajabi_id: null,
        stripe_customer_id: null,
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

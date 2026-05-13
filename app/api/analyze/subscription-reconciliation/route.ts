import { createApiAuth } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/analyze/subscription-reconciliation
 * Compare Stripe, Kajabi, and local overrides to identify discrepancies
 */
export async function GET(request: NextRequest) {
  const { supabase, user } = await createApiAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Query to get membership product IDs
    const { data: membershipProducts, error: productsError } = await supabase
      .schema("bronze")
      .from("kajabi_offers")
      .select("kajabi_offer_id")
      .in("name", ["Quill & Cup Membership", "Yes, girl! I see you!"]);

    if (productsError) {
      console.error("Error fetching membership products:", productsError);
      return NextResponse.json(
        { error: productsError.message },
        { status: 500 }
      );
    }

    const membershipProductIds = membershipProducts?.map(p => p.kajabi_offer_id) || [];

    // Get latest import timestamp for each Bronze table
    const { data: latestKajabiImport } = await supabase
      .schema("bronze")
      .from("kajabi_members")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single();

    const { data: latestStripeImport } = await supabase
      .schema("bronze")
      .from("stripe_subscriptions")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single();

    // Comprehensive query joining all systems
    const { data: reconciliation, error: reconciliationError } = await supabase.rpc(
      "get_subscription_reconciliation",
      { p_membership_product_ids: membershipProductIds }
    );

    if (reconciliationError) {
      // If RPC doesn't exist yet, use manual query
      console.warn("RPC get_subscription_reconciliation not found, using manual query");

      // Manual reconciliation query
      const { data: members } = await supabase
        .from("members")
        .select("id, name, email, kajabi_id");

      // Get Kajabi customers for email matching
      const { data: kajabiCustomers } = await supabase
        .schema("bronze")
        .from("kajabi_customers")
        .select("kajabi_customer_id, email");

      const { data: kajabiPurchases } = await supabase
        .schema("bronze")
        .from("kajabi_purchases")
        .select("*")
        .in("kajabi_offer_id", membershipProductIds);

      // Get Stripe customers for metadata matching
      const { data: stripeCustomers } = await supabase
        .schema("bronze")
        .from("stripe_customers")
        .select("stripe_customer_id, email, data");

      // Get Stripe membership product IDs to filter out retreat payment plans
      const { data: stripeMembershipProducts } = await supabase
        .schema("bronze")
        .from("stripe_products")
        .select("stripe_product_id, name")
        .in("name", ["Quill & Cup Membership", "Yes, girl! I see you!"]);

      const membershipStripeProductIds = new Set(
        stripeMembershipProducts?.map(p => p.stripe_product_id) || []
      );

      if (membershipStripeProductIds.size === 0) {
        console.warn("No Stripe membership products found — subscription filter disabled, using all subscriptions");
      }

      const { data: allStripeSubscriptions } = await supabase
        .schema("bronze")
        .from("stripe_subscriptions")
        .select("*");

      // Filter to only membership subscriptions (exclude retreat payment plans, etc.)
      const stripeSubscriptions = membershipStripeProductIds.size > 0
        ? allStripeSubscriptions?.filter(sub => {
            const items: any[] = sub.data?.items?.data || [];
            return items.some((item: any) =>
              membershipStripeProductIds.has(item.price?.product)
            );
          })
        : allStripeSubscriptions;

      const { data: overrides } = await supabase
        .from("member_status_overrides")
        .select("*");

      // Load email aliases for cross-email member matching
      const { data: emailAliases } = await supabase
        .from("member_email_aliases")
        .select("canonical_email, alias_email");

      // Build lookup maps for performance
      const kajabiCustomerMap = new Map(
        kajabiCustomers?.map(c => [c.kajabi_customer_id, c]) || []
      );

      const stripeCustomerMap = new Map(
        stripeCustomers?.map(c => [c.stripe_customer_id, c]) || []
      );

      // Reverse alias map: canonical_email → Set of alias emails
      // Used to match a member's Stripe subscription when billed under a different email
      const reverseAliasMap = new Map<string, Set<string>>();
      for (const alias of emailAliases || []) {
        const canonical = alias.canonical_email.toLowerCase();
        if (!reverseAliasMap.has(canonical)) reverseAliasMap.set(canonical, new Set());
        reverseAliasMap.get(canonical)!.add(alias.alias_email.toLowerCase());
      }

      // Build reconciliation in memory
      // Only include members who have data in at least one system
      const reconciliationData = members?.map(member => {
        const memberEmail = member.email?.toLowerCase();
        // All emails that belong to this member (canonical + aliases)
        const allMemberEmails = new Set([
          memberEmail,
          ...(reverseAliasMap.get(memberEmail) || []),
        ]);

        // Find Kajabi customer by email (kajabi_id in members is stale)
        const kajabiCustomer = kajabiCustomers?.find(c =>
          allMemberEmails.has(c.email?.toLowerCase())
        );

        // Find Kajabi purchase for this member using the matched customer ID
        // Prefer active purchases (deactivated_at IS NULL) over deactivated ones
        const kajabiPurchase = kajabiCustomer
          ? kajabiPurchases?.filter(p => p.kajabi_customer_id === kajabiCustomer.kajabi_customer_id)
              .sort((a, b) => {
                // Sort by: active first (null deactivated_at), then by created_at descending
                if (!a.deactivated_at && b.deactivated_at) return -1;
                if (a.deactivated_at && !b.deactivated_at) return 1;
                return 0;
              })[0]
          : undefined;

        // Find Stripe subscription for this member using kjb_member_id from metadata
        const stripeSubscription = stripeSubscriptions?.find(s => {
          const customer = stripeCustomerMap.get(s.stripe_customer_id);
          if (!customer) return false;

          // Match by kjb_member_id in metadata (most reliable)
          const kjbMemberId = customer.data?.metadata?.kjb_member_id;
          if (kjbMemberId === member.kajabi_id) return true;

          // Fallback: match by email, including any alias emails for this member
          return allMemberEmails.has(customer.email?.toLowerCase());
        });

        const customer = stripeSubscription
          ? stripeCustomerMap.get(stripeSubscription.stripe_customer_id)
          : null;

        // Find override for this member
        const override = overrides?.find(o => o.member_id === member.id);

        // Determine expected state
        let expectedState = "inactive";
        if (stripeSubscription) {
          if (stripeSubscription.status === "active" && !stripeSubscription.pause_collection) {
            expectedState = "active";
          } else if (stripeSubscription.pause_collection) {
            // Paused subscriptions - check for special cases
            if (override?.override_type === "gift") {
              // Gift/180 program members: paused in Stripe but should be active in Kajabi
              expectedState = "active";
            } else {
              // Regular pause (hiatus or voluntary): should be inactive in Kajabi
              expectedState = "inactive";
            }
          } else if (stripeSubscription.status === "past_due") {
            expectedState = "active"; // Still active until cancelled
          }
        } else if (override?.override_type === "gift") {
          expectedState = "active"; // Gift members should be active even without Stripe
        }

        // Determine actual Kajabi state
        const kajabiState = kajabiPurchase && !kajabiPurchase.deactivated_at
          ? "active"
          : "inactive";

        // Determine actual Stripe state
        let stripeState = "none";
        if (stripeSubscription) {
          if (stripeSubscription.status === "active" && !stripeSubscription.pause_collection) {
            stripeState = "paying";
          } else if (stripeSubscription.pause_collection) {
            stripeState = "paused";
          } else if (stripeSubscription.status === "past_due") {
            stripeState = "past_due";
          } else {
            stripeState = stripeSubscription.status;
          }
        }

        // Identify discrepancy
        const hasDiscrepancy = expectedState === "active" && kajabiState !== "active"
          || expectedState === "inactive" && kajabiState === "active";

        // Check if this member has data in at least one system
        const hasData = !!kajabiPurchase || !!stripeSubscription || !!override;

        return {
          member_id: member.id,
          member_name: member.name,
          member_email: member.email,
          expected_kajabi_state: expectedState,
          actual_kajabi_state: kajabiState,
          stripe_state: stripeState,
          override_type: override?.override_type || null,
          override_reason: override?.reason || null,
          has_discrepancy: hasDiscrepancy,
          has_data: hasData,
        };
      }) || [];

      // Filter to only members with data in at least one system
      const filteredData = reconciliationData.filter(r => r.has_data);

      const summary = {
        total_members: filteredData.length,
        active_in_stripe: stripeSubscriptions?.filter(s =>
          s.status === "active" && !s.pause_collection
        ).length || 0,
        paused_in_stripe: stripeSubscriptions?.filter(s =>
          s.pause_collection
        ).length || 0,
        active_in_kajabi: kajabiPurchases?.filter(p =>
          !p.deactivated_at
        ).length || 0,
        total_overrides: overrides?.length || 0,
        discrepancies: filteredData.filter(r => r.has_discrepancy).length,
      };

      return NextResponse.json({
        summary,
        members: filteredData,
        metadata: {
          kajabi_import_timestamp: latestKajabiImport?.imported_at,
          stripe_import_timestamp: latestStripeImport?.imported_at,
        },
      });
    }

    return NextResponse.json({
      reconciliation,
      metadata: {
        kajabi_import_timestamp: latestKajabiImport?.imported_at,
        stripe_import_timestamp: latestStripeImport?.imported_at,
      },
    });
  } catch (error: any) {
    console.error("Error analyzing subscription reconciliation:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to analyze subscription reconciliation",
        details: error.stack,
      },
      { status: 500 }
    );
  }
}

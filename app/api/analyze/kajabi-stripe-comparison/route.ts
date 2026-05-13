import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Analyze discrepancies between Kajabi and Stripe subscription data
 *
 * This endpoint:
 * 1. Fetches Kajabi purchases (subscription offers only)
 * 2. Fetches Stripe subscriptions
 * 3. Matches them by customer email
 * 4. Reports discrepancies and status differences
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Get Kajabi subscription purchases (the two membership offers)
    const { data: kajabiPurchases } = await supabase
      .schema('bronze')
      .from('kajabi_purchases')
      .select('*, data')
      .in('kajabi_offer_id', ['2148128038', '2148293442']);

    // 2. Get Kajabi customers
    const { data: kajabiCustomers } = await supabase
      .schema('bronze')
      .from('kajabi_customers')
      .select('*');

    // 3. Get Stripe subscriptions
    const { data: stripeSubscriptions } = await supabase
      .schema('bronze')
      .from('stripe_subscriptions')
      .select('*');

    // 4. Get Stripe customers
    const { data: stripeCustomers } = await supabase
      .schema('bronze')
      .from('stripe_customers')
      .select('*');

    // Build lookup maps
    const kajabiCustomerMap = new Map(
      kajabiCustomers?.map(c => [c.kajabi_customer_id, c]) || []
    );

    const stripeCustomerMap = new Map(
      stripeCustomers?.map(c => [c.stripe_customer_id, c]) || []
    );

    // Group subscriptions by email for comparison
    const kajabiByEmail = new Map<string, any[]>();
    kajabiPurchases?.forEach(purchase => {
      const customer = kajabiCustomerMap.get(purchase.kajabi_customer_id);
      if (customer?.email) {
        const email = customer.email.toLowerCase();
        if (!kajabiByEmail.has(email)) {
          kajabiByEmail.set(email, []);
        }
        kajabiByEmail.get(email)!.push({
          id: purchase.kajabi_purchase_id,
          status: purchase.deactivated_at ? 'canceled' : 'active',
          deactivated_at: purchase.deactivated_at,
        });
      }
    });

    const stripeByEmail = new Map<string, any[]>();
    stripeSubscriptions?.forEach(subscription => {
      const customer = stripeCustomerMap.get(subscription.stripe_customer_id);
      if (customer?.email) {
        const email = customer.email.toLowerCase();
        if (!stripeByEmail.has(email)) {
          stripeByEmail.set(email, []);
        }
        stripeByEmail.get(email)!.push({
          id: subscription.stripe_subscription_id,
          status: subscription.status,
          canceled_at: subscription.canceled_at,
        });
      }
    });

    // Analyze discrepancies
    const analysis = {
      kajabi: {
        total: kajabiPurchases?.length || 0,
        nonCanceled: kajabiPurchases?.filter(p => !p.deactivated_at).length || 0,
        canceled: kajabiPurchases?.filter(p => p.deactivated_at).length || 0,
        uniqueEmails: kajabiByEmail.size,
      },
      stripe: {
        total: stripeSubscriptions?.length || 0,
        byStatus: stripeSubscriptions?.reduce((acc, sub) => {
          acc[sub.status] = (acc[sub.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>) || {},
        uniqueEmails: stripeByEmail.size,
      },
      comparison: {
        inBoth: 0,
        onlyKajabi: 0,
        onlyStripe: 0,
        statusMismatches: [] as any[],
      },
    };

    // Find matches and mismatches
    for (const [email, kajabiSubs] of kajabiByEmail) {
      const stripeSubs = stripeByEmail.get(email);

      if (stripeSubs) {
        analysis.comparison.inBoth++;

        // Check for status mismatches
        kajabiSubs.forEach(kajabi => {
          stripeSubs.forEach(stripe => {
            // Compare statuses
            const kajabiStatus = kajabi.status; // 'active' or 'canceled'
            const stripeStatus = stripe.status;

            // Flag if Kajabi says active but Stripe says paused/past_due
            if (kajabiStatus === 'active' && ['paused', 'past_due'].includes(stripeStatus)) {
              analysis.comparison.statusMismatches.push({
                email,
                kajabiId: kajabi.id,
                kajabiStatus,
                stripeId: stripe.id,
                stripeStatus,
              });
            }
          });
        });
      } else {
        analysis.comparison.onlyKajabi++;
      }
    }

    for (const email of stripeByEmail.keys()) {
      if (!kajabiByEmail.has(email)) {
        analysis.comparison.onlyStripe++;
      }
    }

    // Get sample mismatches for display
    const sampleMismatches = analysis.comparison.statusMismatches.slice(0, 10);

    return NextResponse.json({
      success: true,
      analysis,
      sampleMismatches,
      summary: {
        kajabiNonCanceled: analysis.kajabi.nonCanceled,
        stripeNonCanceled: Object.entries(analysis.stripe.byStatus)
          .filter(([status]) => !['canceled', 'incomplete_expired'].includes(status))
          .reduce((sum, [_, count]) => sum + (count as number), 0),
        discrepancy: analysis.kajabi.nonCanceled - (analysis.stripe.byStatus['active'] || 0),
      },
    });
  } catch (error: any) {
    console.error("Error analyzing Kajabi vs Stripe:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to analyze data",
        details: error.stack,
      },
      { status: 500 }
    );
  }
}

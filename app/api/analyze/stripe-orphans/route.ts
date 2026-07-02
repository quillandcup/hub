import { requireAdmin } from "@/lib/supabase/api-auth";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { buildReverseAliasMap, matchStripeCustomerToMember } from "@/lib/stripe-matching";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/analyze/stripe-orphans
 * Active Stripe membership subscribers with no matching member record in Hub.
 * These are people who are paying but were never onboarded (e.g. signed up via
 * a different email than their Kajabi contact, or bypassed Kajabi entirely).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const [
      { data: stripeProducts },
      { data: members },
      { data: emailAliases },
    ] = await Promise.all([
      supabase.schema("bronze").from("stripe_products").select("stripe_product_id").in("name", [...MEMBERSHIP_PRODUCT_NAMES]),
      supabase.from("members").select("id, email, kajabi_id"),
      supabase.from("member_email_aliases").select("canonical_email, alias_email"),
    ]);

    const membershipProductIds = new Set(
      (stripeProducts ?? []).map((p) => p.stripe_product_id)
    );

    if (membershipProductIds.size === 0) {
      console.warn("stripe-orphans: no membership Stripe products found");
    }

    // Load all customers and subscriptions (paginated)
    const stripeCustomers: any[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .schema("bronze")
          .from("stripe_customers")
          .select("stripe_customer_id, email, data")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          stripeCustomers.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    const allSubscriptions: any[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .schema("bronze")
          .from("stripe_subscriptions")
          .select("stripe_subscription_id, stripe_customer_id, status, created_at, data")
          .eq("status", "active")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          allSubscriptions.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    const customerMap = new Map(
      stripeCustomers.map((c) => [c.stripe_customer_id, c])
    );

    // Filter to membership subscriptions only
    const membershipSubscriptions = membershipProductIds.size > 0
      ? allSubscriptions.filter((sub) => {
          const items: any[] = sub.data?.items?.data ?? [];
          return items.some((item: any) => membershipProductIds.has(item.price?.product));
        })
      : allSubscriptions;

    const reverseAliasMap = buildReverseAliasMap(emailAliases ?? []);

    const orphans: Array<{
      stripe_customer_id: string;
      email: string | null;
      name: string | null;
      created_at: string | null;
    }> = [];

    for (const sub of membershipSubscriptions) {
      const customer = customerMap.get(sub.stripe_customer_id);
      if (!customer) continue;

      const match = matchStripeCustomerToMember(customer, members ?? [], reverseAliasMap);
      if (!match) {
        orphans.push({
          stripe_customer_id: sub.stripe_customer_id,
          email: customer.email ?? null,
          name: customer.data?.name ?? null,
          created_at: sub.created_at ?? null,
        });
      }
    }

    return NextResponse.json({
      total_active_subscriptions: membershipSubscriptions.length,
      orphans,
    });
  } catch (error: any) {
    console.error("Error analyzing Stripe orphans:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze Stripe orphans" },
      { status: 500 }
    );
  }
}

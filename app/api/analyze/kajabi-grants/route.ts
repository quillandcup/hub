import { requireAdmin } from "@/lib/supabase/api-auth";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/analyze/kajabi-grants
 * Active Kajabi membership purchases with no real transaction behind them —
 * the mirror image of /api/analyze/stripe-orphans (money with no Kajabi
 * record) and the reconciliation page's direct_stripe detection (Kajabi
 * record with no money): here Kajabi says active, but nothing was ever
 * actually paid. Surfaces both purchases granted via the Kajabi API
 * (POST /v1/contacts/{id}/relationships/offers, which creates a purchase
 * with no subscription/transactions behind it — see docs/TODO.md) and any
 * pre-existing manually-comped purchases, so they don't quietly become an
 * invisible blind spot the same way ad-hoc Stripe subscriptions did.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { data: membershipOffers } = await supabase
      .schema("bronze")
      .from("kajabi_offers")
      .select("kajabi_offer_id, name")
      .in("name", [...MEMBERSHIP_PRODUCT_NAMES]);

    const offerNameById = new Map((membershipOffers ?? []).map((o) => [o.kajabi_offer_id, o.name]));
    const membershipOfferIds = [...offerNameById.keys()];

    if (membershipOfferIds.length === 0) {
      return NextResponse.json({ grants: [] });
    }

    const purchases: any[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch, error } = await supabase
          .schema("bronze")
          .from("kajabi_purchases")
          .select("kajabi_purchase_id, kajabi_customer_id, kajabi_offer_id, amount_in_cents, created_at_kajabi, deactivated_at, data")
          .in("kajabi_offer_id", membershipOfferIds)
          .is("deactivated_at", null)
          .range(offset, offset + 999);
        if (error) throw error;
        if (batch && batch.length > 0) {
          purchases.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // A grant has no real transaction behind it — no money moved. Some historical
    // purchases may not have their transactions relationship populated at all
    // (older sync), so amount_in_cents === 0 is a second, independent signal.
    const grantedPurchases = purchases.filter((p) => {
      const txnCount = p.data?.relationships?.transactions?.data?.length ?? 0;
      return txnCount === 0 || p.amount_in_cents === 0;
    });

    if (grantedPurchases.length === 0) {
      return NextResponse.json({ grants: [] });
    }

    const customerIds = [...new Set(grantedPurchases.map((p) => p.kajabi_customer_id))];
    const { data: kajabiCustomers } = await supabase
      .schema("bronze")
      .from("kajabi_customers")
      .select("kajabi_customer_id, email")
      .in("kajabi_customer_id", customerIds);
    const emailByCustomerId = new Map((kajabiCustomers ?? []).map((c) => [c.kajabi_customer_id, c.email]));

    const emails = [...new Set([...emailByCustomerId.values()].filter(Boolean))];
    const { data: members } = await supabase
      .from("members")
      .select("id, name, email, status")
      .in("email", emails);
    const memberByEmail = new Map((members ?? []).map((m) => [m.email?.toLowerCase(), m]));

    const grants = grantedPurchases.map((p) => {
      const email = emailByCustomerId.get(p.kajabi_customer_id) ?? null;
      const member = email ? memberByEmail.get(email.toLowerCase()) : undefined;
      return {
        kajabi_purchase_id: p.kajabi_purchase_id,
        offer_name: offerNameById.get(p.kajabi_offer_id) ?? p.kajabi_offer_id,
        amount_in_cents: p.amount_in_cents,
        created_at: p.created_at_kajabi,
        member_id: member?.id ?? null,
        member_name: member?.name ?? null,
        member_email: email,
        member_status: member?.status ?? null,
      };
    });

    return NextResponse.json({ grants });
  } catch (error: any) {
    console.error("Error analyzing Kajabi grants:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze Kajabi grants" },
      { status: 500 }
    );
  }
}

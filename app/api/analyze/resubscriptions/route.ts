import { requireAdmin } from "@/lib/supabase/api-auth";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { NextRequest, NextResponse } from "next/server";

export interface ResubscriptionEvent {
  resubscribedAt: string;
  cancelledAt: string;
  gapDays: number;
}

export interface ResubscribingMember {
  memberId: string | null;
  memberName: string;
  memberEmail: string;
  resubscriptions: ResubscriptionEvent[];
  isCurrentlyActive: boolean;
}

export interface ResubscriptionCohort {
  month: string; // YYYY-MM
  label: string; // "Jan 2025"
  count: number;
}

export interface ResubscriptionsResponse {
  totalResubscribingMembers: number;
  totalResubscriptionEvents: number;
  members: ResubscribingMember[];
  cohortByMonth: ResubscriptionCohort[];
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  // Fetch membership offer IDs
  const { data: membershipOffers } = await supabase
    .schema("bronze")
    .from("kajabi_offers")
    .select("kajabi_offer_id")
    .in("name", [...MEMBERSHIP_PRODUCT_NAMES]);

  const offerIds = membershipOffers?.map((o) => o.kajabi_offer_id) ?? [];

  // Fetch all membership purchases (paginated)
  type Purchase = {
    kajabi_purchase_id: string;
    kajabi_customer_id: string;
    effective_start_at: string | null;
    created_at_kajabi: string | null;
    deactivated_at: string | null;
    status: string | null;
  };

  const allPurchases: Purchase[] = [];
  let offset = 0;
  const BATCH = 1000;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .schema("bronze")
      .from("kajabi_purchases")
      .select("kajabi_purchase_id, kajabi_customer_id, effective_start_at, created_at_kajabi, deactivated_at, status")
      .range(offset, offset + BATCH - 1);

    if (offerIds.length > 0) {
      query = query.in("kajabi_offer_id", offerIds);
    }

    const { data: batch } = await query;
    if (batch && batch.length > 0) {
      allPurchases.push(...(batch as Purchase[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  // Fetch customer info for name/email
  type Customer = { kajabi_customer_id: string; email: string; name: string | null };
  const allCustomers: Customer[] = [];
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .schema("bronze")
      .from("kajabi_customers")
      .select("kajabi_customer_id, email, name")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      allCustomers.push(...(batch as Customer[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  // Fetch silver members for ID linkage
  type Member = { id: string; email: string };
  const allMembers: Member[] = [];
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, email")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      allMembers.push(...(batch as Member[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  const customerMap = new Map(allCustomers.map((c) => [c.kajabi_customer_id, c]));
  const memberByEmail = new Map(allMembers.map((m) => [m.email.toLowerCase(), m.id]));

  // Group purchases by customer, sorted chronologically
  const byCustomer = new Map<string, Purchase[]>();
  for (const purchase of allPurchases) {
    const list = byCustomer.get(purchase.kajabi_customer_id) ?? [];
    list.push(purchase);
    byCustomer.set(purchase.kajabi_customer_id, list);
  }

  const resubscribingMembers: ResubscribingMember[] = [];

  for (const [customerId, purchases] of byCustomer.entries()) {
    // Sort by start date, falling back to created_at
    purchases.sort((a, b) => {
      const aDate = a.effective_start_at ?? a.created_at_kajabi ?? "";
      const bDate = b.effective_start_at ?? b.created_at_kajabi ?? "";
      return aDate.localeCompare(bDate);
    });

    const resubscriptions: ResubscriptionEvent[] = [];

    // Walk through purchases: if a later purchase starts after a previous was cancelled, it's a resub
    let latestCancellation: string | null = null;

    for (const purchase of purchases) {
      const startDate = purchase.effective_start_at ?? purchase.created_at_kajabi;
      if (!startDate) continue;

      if (latestCancellation && startDate > latestCancellation) {
        const cancelledAt = latestCancellation;
        const gapMs = new Date(startDate).getTime() - new Date(cancelledAt).getTime();
        const gapDays = Math.round(gapMs / (1000 * 60 * 60 * 24));
        resubscriptions.push({
          resubscribedAt: startDate,
          cancelledAt,
          gapDays,
        });
      }

      // Track the latest cancellation seen so far
      if (purchase.deactivated_at) {
        if (!latestCancellation || purchase.deactivated_at > latestCancellation) {
          latestCancellation = purchase.deactivated_at;
        }
      }
    }

    if (resubscriptions.length === 0) continue;

    const customer = customerMap.get(customerId);
    const email = customer?.email ?? "";
    const memberId = memberByEmail.get(email.toLowerCase()) ?? null;

    // Is their most recent purchase still active?
    const lastPurchase = purchases[purchases.length - 1];
    const isCurrentlyActive = !lastPurchase.deactivated_at;

    resubscribingMembers.push({
      memberId,
      memberName: customer?.name ?? email,
      memberEmail: email,
      resubscriptions,
      isCurrentlyActive,
    });
  }

  // Build cohort by month (using resubscription date)
  const cohortMap = new Map<string, number>();
  for (const member of resubscribingMembers) {
    for (const event of member.resubscriptions) {
      const month = event.resubscribedAt.slice(0, 7); // YYYY-MM
      cohortMap.set(month, (cohortMap.get(month) ?? 0) + 1);
    }
  }

  // Fill in months from first resubscription to now, including zero months
  const allMonths = Array.from(cohortMap.keys()).sort();
  const cohortByMonth: ResubscriptionCohort[] = [];

  if (allMonths.length > 0) {
    const start = new Date(allMonths[0] + "-01");
    const end = new Date();
    end.setDate(1);
    const cursor = new Date(start);

    while (cursor <= end) {
      const month = cursor.toISOString().slice(0, 7);
      const label = cursor.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      cohortMap.set(month, cohortMap.get(month) ?? 0);
      cohortByMonth.push({ month, label, count: cohortMap.get(month)! });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const totalEvents = resubscribingMembers.reduce(
    (sum, m) => sum + m.resubscriptions.length,
    0
  );

  return NextResponse.json({
    totalResubscribingMembers: resubscribingMembers.length,
    totalResubscriptionEvents: totalEvents,
    members: resubscribingMembers.sort((a, b) =>
      a.memberName.localeCompare(b.memberName)
    ),
    cohortByMonth,
  } satisfies ResubscriptionsResponse);
}

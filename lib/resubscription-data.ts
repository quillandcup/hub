import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { detectResubscriptions } from "@/lib/resubscription-detection";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResubscribingMember {
  memberId: string | null;
  memberName: string;
  memberEmail: string;
  resubscriptions: import("@/lib/resubscription-detection").ResubscriptionEvent[];
  isCurrentlyActive: boolean;
}

export interface ResubscriptionCohort {
  month: string;
  label: string;
  count: number;
}

export interface ResubscriptionsData {
  totalResubscribingMembers: number;
  totalActiveMembers: number;
  members: ResubscribingMember[];
  cohortByMonth: ResubscriptionCohort[];
}

export async function fetchResubscriptionsData(
  supabase: SupabaseClient
): Promise<ResubscriptionsData> {
  const BATCH = 1000;

  // Fetch membership offer IDs
  const { data: membershipOffers } = await supabase
    .schema("bronze")
    .from("kajabi_offers")
    .select("kajabi_offer_id")
    .in("name", [...MEMBERSHIP_PRODUCT_NAMES]);

  const offerIds = membershipOffers?.map((o: any) => o.kajabi_offer_id) ?? [];

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

  // Fetch silver members for ID linkage and active count
  type Member = { id: string; email: string; status: string };
  const allMembers: Member[] = [];
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, email, status")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      allMembers.push(...(batch as Member[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  // Fetch email aliases to resolve merged/renamed member identities
  // alias_email → canonical_email
  const aliasToCanonical = new Map<string, string>();
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("member_email_aliases")
      .select("canonical_email, alias_email")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      for (const { canonical_email, alias_email } of batch as { canonical_email: string; alias_email: string }[]) {
        aliasToCanonical.set(alias_email.toLowerCase(), canonical_email.toLowerCase());
      }
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  const customerMap = new Map(allCustomers.map((c) => [c.kajabi_customer_id, c]));
  const memberByEmail = new Map(allMembers.map((m) => [m.email.toLowerCase(), m.id]));

  // Resolve a customer email to its canonical member email (via alias table)
  function canonicalEmail(email: string): string {
    const lower = email.toLowerCase();
    return aliasToCanonical.get(lower) ?? lower;
  }

  // Group purchases by canonical email so that merged/renamed members are combined
  type EmailPurchases = { purchases: Purchase[]; customerIds: Set<string> };
  const byEmail = new Map<string, EmailPurchases>();

  for (const purchase of allPurchases) {
    const customer = customerMap.get(purchase.kajabi_customer_id);
    if (!customer) continue;
    const key = canonicalEmail(customer.email);
    if (!byEmail.has(key)) byEmail.set(key, { purchases: [], customerIds: new Set() });
    const entry = byEmail.get(key)!;
    entry.purchases.push(purchase);
    entry.customerIds.add(purchase.kajabi_customer_id);
  }

  const resubscribingMembers: ResubscribingMember[] = [];

  for (const [email, { purchases, customerIds }] of byEmail.entries()) {
    const resubscriptions = detectResubscriptions(purchases);
    if (resubscriptions.length === 0) continue;

    // Prefer name from whichever customer record has one
    const name =
      Array.from(customerIds)
        .map((id) => customerMap.get(id)?.name)
        .find((n) => n) ?? email;

    const memberId = memberByEmail.get(email) ?? null;

    const sorted = [...purchases].sort((a, b) =>
      (a.effective_start_at ?? a.created_at_kajabi ?? "").localeCompare(
        b.effective_start_at ?? b.created_at_kajabi ?? ""
      )
    );
    const lastPurchase = sorted[sorted.length - 1];

    resubscribingMembers.push({
      memberId,
      memberName: name,
      memberEmail: email,
      resubscriptions,
      isCurrentlyActive: !lastPurchase.deactivated_at,
    });
  }

  // Build cohort by month
  const cohortMap = new Map<string, number>();
  for (const member of resubscribingMembers) {
    for (const event of member.resubscriptions) {
      const month = event.resubscribedAt.slice(0, 7);
      cohortMap.set(month, (cohortMap.get(month) ?? 0) + 1);
    }
  }

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
      cohortByMonth.push({ month, label, count: cohortMap.get(month) ?? 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const totalActiveMembers = allMembers.filter(
    (m) => m.status === "active" || m.status === "on_hiatus"
  ).length;

  return {
    totalResubscribingMembers: resubscribingMembers.length,
    totalActiveMembers,
    members: resubscribingMembers.sort((a, b) => a.memberName.localeCompare(b.memberName)),
    cohortByMonth,
  };
}

import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { detectResubscriptions } from "@/lib/resubscription-detection";
import { buildReverseAliasMap, getMemberEmails } from "@/lib/stripe-matching";
import type { MemberEmailAlias } from "@/lib/member-matching";
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

  // Fetch customer info: email → customer_id lookup
  type Customer = { kajabi_customer_id: string; email: string };
  const allCustomers: Customer[] = [];
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .schema("bronze")
      .from("kajabi_customers")
      .select("kajabi_customer_id, email")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      allCustomers.push(...(batch as Customer[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  // Fetch silver members
  type Member = { id: string; name: string; email: string; status: string };
  const allMembers: Member[] = [];
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, name, email, status")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      allMembers.push(...(batch as Member[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  // Fetch email aliases and build the standard reverse alias map
  const emailAliases: MemberEmailAlias[] = [];
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("member_email_aliases")
      .select("canonical_email, alias_email")
      .range(offset, offset + BATCH - 1);

    if (batch && batch.length > 0) {
      emailAliases.push(...(batch as MemberEmailAlias[]));
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  const reverseAliasMap = buildReverseAliasMap(emailAliases);

  // customer_email (lowercase) → all customer_ids (one email can have multiple Kajabi records)
  const customerIdsByEmail = new Map<string, string[]>();
  for (const c of allCustomers) {
    const key = c.email.toLowerCase();
    const list = customerIdsByEmail.get(key) ?? [];
    list.push(c.kajabi_customer_id);
    customerIdsByEmail.set(key, list);
  }

  // customer_id → purchases
  const purchasesByCustomerId = new Map<string, Purchase[]>();
  for (const p of allPurchases) {
    const list = purchasesByCustomerId.get(p.kajabi_customer_id) ?? [];
    list.push(p);
    purchasesByCustomerId.set(p.kajabi_customer_id, list);
  }

  // For each silver member, resolve all their emails and aggregate purchases
  const resubscribingMembers: ResubscribingMember[] = [];

  for (const member of allMembers) {
    const allEmails = getMemberEmails(member, reverseAliasMap);

    const memberPurchases: Purchase[] = [];
    for (const email of allEmails) {
      for (const customerId of customerIdsByEmail.get(email) ?? []) {
        memberPurchases.push(...(purchasesByCustomerId.get(customerId) ?? []));
      }
    }

    if (memberPurchases.length === 0) continue;

    const resubscriptions = detectResubscriptions(memberPurchases);
    if (resubscriptions.length === 0) continue;

    const sorted = [...memberPurchases].sort((a, b) =>
      (a.effective_start_at ?? a.created_at_kajabi ?? "").localeCompare(
        b.effective_start_at ?? b.created_at_kajabi ?? ""
      )
    );
    const lastPurchase = sorted[sorted.length - 1];

    resubscribingMembers.push({
      memberId: member.id,
      memberName: member.name,
      memberEmail: member.email,
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

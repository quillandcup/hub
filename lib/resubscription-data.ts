import type { Repos } from "@/lib/data/repos";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { detectResubscriptions } from "@/lib/resubscription-detection";
import { buildReverseAliasMap, getMemberEmails } from "@/lib/stripe-matching";

type ResubscriptionRepos = Pick<Repos, "aliases" | "billing" | "members">;

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
  repos: ResubscriptionRepos
): Promise<ResubscriptionsData> {
  const billing = repos.billing;

  // Fetch membership offer IDs
  const membershipOffers = await billing.kajabiOffersByName([...MEMBERSHIP_PRODUCT_NAMES]);
  const offerIds = membershipOffers.map((o) => o.kajabi_offer_id);

  // Fetch all membership purchases (paginated; every purchase when no membership offer is known)
  type Purchase = {
    kajabi_purchase_id: string;
    kajabi_customer_id: string;
    effective_start_at: string | null;
    created_at_kajabi: string | null;
    deactivated_at: string | null;
    status: string | null;
  };

  const allPurchases = (await billing.kajabiPurchases(offerIds.length > 0 ? { offerIds } : {})) as Purchase[];

  // Fetch customer info: email → customer_id lookup
  const allCustomers = await billing.kajabiCustomers();

  // Fetch silver members
  const allMembers = await repos.members.list();

  // Fetch email aliases and build the standard reverse alias map
  const emailAliases = await repos.aliases.emailAliases();

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

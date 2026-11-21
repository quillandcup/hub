import type { Repos } from "@/lib/data/repos";
import type { Member } from "@/lib/data/members";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";

export interface PurchaseMembers {
  /** Each customer's email, run through the active email aliases (lower case). */
  emailByCustomerId: Map<string, string>;
  /** The members with one of those emails, by lower-cased email. */
  memberByEmail: Map<string, Member>;
}

/**
 * Who bought: maps purchases to Hub members through the buyer's Kajabi customer email and the
 * active email aliases. A purchase whose customer has no member is simply absent from
 * `memberByEmail`; callers decide whether to skip it (program cohorts) or show it (events).
 * Shared by the program cohort matching and the event ticket matching.
 */
export async function membersForPurchases(
  repos: Pick<Repos, "aliases" | "billing" | "members">,
  purchases: { kajabi_customer_id: string | null }[]
): Promise<PurchaseMembers> {
  const customerIds = Array.from(new Set(purchases.map((p) => p.kajabi_customer_id).filter((id): id is string => !!id)));
  const [customers, emailAliases] = await Promise.all([
    repos.billing.kajabiCustomers({ customerIds }),
    repos.aliases.emailAliases({ activeOnly: true }),
  ]);

  const aliasMap = buildAliasMap(emailAliases || []);
  const emailByCustomerId = new Map<string, string>();
  for (const c of customers) {
    if (c.email) emailByCustomerId.set(c.kajabi_customer_id, resolveEmail(c.email, aliasMap));
  }

  const canonicalEmails = Array.from(new Set(emailByCustomerId.values()));
  if (canonicalEmails.length === 0) return { emailByCustomerId, memberByEmail: new Map() };

  const members = await repos.members.byEmails(canonicalEmails);
  return { emailByCustomerId, memberByEmail: new Map(members.map((m) => [m.email.toLowerCase(), m])) };
}

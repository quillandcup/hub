import { createClient } from "@/lib/supabase/server";
import { buildAliasMap } from "@/lib/email-aliases";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "External Conflicts",
};

interface ConflictEntry {
  externalId: string;
  email: string;
  name: string | null;
  detail?: string;
}

interface ConflictGroup {
  canonicalEmail: string;
  memberId: string | null;
  memberName: string | null;
  entries: ConflictEntry[];
}

function groupByCanonical<T extends { email: string }>(
  items: T[],
  aliasMap: Map<string, string>,
  getId: (item: T) => string,
  getName: (item: T) => string | null,
  getDetail?: (item: T) => string | undefined,
): ConflictGroup[] {
  const grouped = new Map<string, ConflictEntry[]>();
  for (const item of items) {
    const normalized = item.email.toLowerCase();
    const canonical = aliasMap.get(normalized) ?? normalized;
    const entries = grouped.get(canonical) ?? [];
    entries.push({ externalId: getId(item), email: normalized, name: getName(item), detail: getDetail?.(item) });
    grouped.set(canonical, entries);
  }
  return Array.from(grouped.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([canonicalEmail, entries]) => ({ canonicalEmail, memberId: null, memberName: null, entries }))
    .sort((a, b) => a.canonicalEmail.localeCompare(b.canonicalEmail));
}

export default async function ExternalConflictsPage() {
  const supabase = await createClient();

  const paginate = async <T,>(
    queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
  ): Promise<T[]> => {
    const rows: T[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await queryFn(offset, offset + 999);
      if (data?.length) { rows.push(...data); offset += data.length; hasMore = data.length === 1000; }
      else hasMore = false;
    }
    return rows;
  };

  const [
    emailAliases,
    kajabiContacts,
    stripeCustomers,
    slackUsers,
    members,
    stripeActiveSubs,
    kajabiActivePurchases,
    kajabiCustomers,
  ] = await Promise.all([
    supabase.from("member_email_aliases").select("alias_email, canonical_email").then(r => r.data ?? []),
    paginate((from, to) => supabase.schema("bronze").from("kajabi_contacts")
      .select("kajabi_contact_id, email, name").range(from, to)),
    paginate((from, to) => supabase.schema("bronze").from("stripe_customers")
      .select("stripe_customer_id, email, name").range(from, to)),
    paginate((from, to) => supabase.schema("bronze").from("slack_users")
      .select("user_id, email, real_name, display_name").eq("is_bot", false).range(from, to)),
    supabase.from("members").select("id, name, email").then(r => r.data ?? []),
    supabase.schema("bronze").from("stripe_subscriptions")
      .select("stripe_customer_id, status")
      .in("status", ["active", "trialing", "past_due"]).then(r => r.data ?? []),
    supabase.schema("bronze").from("kajabi_purchases")
      .select("kajabi_customer_id").eq("status", "active").then(r => r.data ?? []),
    paginate((from, to) => supabase.schema("bronze").from("kajabi_customers")
      .select("kajabi_customer_id, email").range(from, to)),
  ]);

  const aliasMap = buildAliasMap(emailAliases ?? []);

  // Member and Kajabi customer lookups
  const memberByEmail = new Map<string, { id: string; name: string }>();
  for (const m of members ?? []) memberByEmail.set(m.email.toLowerCase(), { id: m.id, name: m.name });

  const activePurchaseCustomers = new Set((kajabiActivePurchases ?? []).map(p => p.kajabi_customer_id));
  const activeSubsByStripeCustomer = new Map<string, number>();
  for (const s of stripeActiveSubs ?? []) {
    activeSubsByStripeCustomer.set(s.stripe_customer_id, (activeSubsByStripeCustomer.get(s.stripe_customer_id) ?? 0) + 1);
  }

  const kajabiCustomerByEmail = new Map<string, string>();
  for (const c of kajabiCustomers ?? []) kajabiCustomerByEmail.set(c.email.toLowerCase(), c.kajabi_customer_id);

  const kajabiGroups = groupByCanonical(
    kajabiContacts ?? [],
    aliasMap,
    c => c.kajabi_contact_id,
    c => c.name ?? null,
    c => {
      const normalized = c.email.toLowerCase();
      const canonical = aliasMap.get(normalized) ?? normalized;
      const customerId = kajabiCustomerByEmail.get(normalized) ?? kajabiCustomerByEmail.get(canonical);
      return customerId && activePurchaseCustomers.has(customerId) ? "active subscription" : undefined;
    },
  );

  const stripeGroups = groupByCanonical(
    stripeCustomers ?? [],
    aliasMap,
    c => c.stripe_customer_id,
    c => c.name ?? null,
    c => {
      const count = activeSubsByStripeCustomer.get(c.stripe_customer_id) ?? 0;
      return count > 0 ? `${count} active subscription${count !== 1 ? "s" : ""}` : undefined;
    },
  );

  const slackGroups = groupByCanonical(
    slackUsers ?? [],
    aliasMap,
    u => u.user_id,
    u => (u.real_name || u.display_name) ?? null,
  );

  // Attach member info to groups
  function enrichGroups(groups: ConflictGroup[]): ConflictGroup[] {
    return groups.map(g => {
      const member = memberByEmail.get(g.canonicalEmail);
      return { ...g, memberId: member?.id ?? null, memberName: member?.name ?? null };
    });
  }

  const allKajabi = enrichGroups(kajabiGroups);
  const allStripe = enrichGroups(stripeGroups);
  const allSlack = enrichGroups(slackGroups);
  const totalConflicts = allKajabi.length + allStripe.length + allSlack.length;

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          <Link href="/admin/hygiene" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            ← Data Hygiene
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">External Conflicts</h1>
          {totalConflicts > 0 ? (
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
              {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              All clear
            </span>
          )}
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
          Detects cases where the same person (same canonical email) has multiple accounts in Kajabi, Stripe, or Slack.
          Duplicate Stripe customers with active subscriptions indicate someone is being double-charged.
        </p>

        {totalConflicts === 0 && (
          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-8 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="font-semibold text-green-800 dark:text-green-200">No external conflicts detected</p>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              Each member has at most one account in each external system.
            </p>
          </div>
        )}

        {allKajabi.length > 0 && (
          <ConflictSection
            title="Kajabi"
            emoji="📚"
            count={allKajabi.length}
            description="Members with multiple Kajabi contacts under the same email. They may have duplicate course access or split purchase history."
          >
            {allKajabi.map(group => (
              <ConflictRow
                key={group.canonicalEmail}
                group={group}
                renderEntry={(entry) => (
                  <span className="flex items-center gap-2">
                    <a
                      href={`https://app.kajabi.com/admin/contacts/${entry.externalId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {entry.externalId}
                    </a>
                    {entry.detail && (
                      <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                        {entry.detail}
                      </span>
                    )}
                  </span>
                )}
              />
            ))}
          </ConflictSection>
        )}

        {allStripe.length > 0 && (
          <ConflictSection
            title="Stripe"
            emoji="💳"
            count={allStripe.length}
            description="Members with multiple Stripe customers under the same email. Those with active subscriptions on more than one customer are being double-charged."
          >
            {allStripe.map(group => (
              <ConflictRow
                key={group.canonicalEmail}
                group={group}
                renderEntry={(entry) => (
                  <span className="flex items-center gap-2">
                    <a
                      href={`https://dashboard.stripe.com/customers/${entry.externalId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {entry.externalId}
                    </a>
                    {entry.detail && (
                      <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                        {entry.detail}
                      </span>
                    )}
                  </span>
                )}
              />
            ))}
          </ConflictSection>
        )}

        {allSlack.length > 0 && (
          <ConflictSection
            title="Slack"
            emoji="💬"
            count={allSlack.length}
            description="Members with multiple Slack accounts under the same canonical email. Message history may be split. Email aliases usually resolve attribution automatically."
          >
            {allSlack.map(group => (
              <ConflictRow
                key={group.canonicalEmail}
                group={group}
                renderEntry={(entry) => (
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    {entry.externalId}
                    {entry.name && <span className="ml-1 text-slate-400 dark:text-slate-500">({entry.name})</span>}
                  </span>
                )}
              />
            ))}
          </ConflictSection>
        )}
      </div>
    </div>
  );
}

function ConflictSection({
  title, emoji, count, description, children,
}: {
  title: string;
  emoji: string;
  count: number;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{emoji}</span>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
          {count}
        </span>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{description}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ConflictRow({
  group,
  renderEntry,
}: {
  group: ConflictGroup;
  renderEntry: (entry: ConflictEntry) => ReactNode;
}) {
  return (
    <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          {group.memberId ? (
            <Link
              href={`/admin/members/${group.memberId}`}
              className="font-semibold text-sm text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400"
            >
              {group.memberName ?? group.canonicalEmail}
            </Link>
          ) : (
            <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
              {group.memberName ?? group.canonicalEmail}
            </span>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">{group.canonicalEmail}</p>
        </div>
        <span className="text-xs text-orange-600 dark:text-orange-400 font-semibold flex-shrink-0">
          {group.entries.length} accounts
        </span>
      </div>
      <div className="space-y-2">
        {group.entries.map((entry, i) => (
          <div key={i} className="flex items-center gap-3 text-xs">
            <span className="text-slate-300 dark:text-slate-600">•</span>
            <span className="text-slate-500 dark:text-slate-400 min-w-[180px] truncate">{entry.email}</span>
            {renderEntry(entry)}
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import type { BillingOverview as Overview } from "@/lib/billing-reconciliation-loader";
import { HUB_STATUS_FILTERS, ISSUE_GROUPS, buildIssues, issueTotals, issuesIn, parseHubStatusFilter, parseIssueFilter, selectIssues, type HubStatusFilterId, type IssueFilter } from "@/lib/billing-issues";
import { formatCents } from "@/lib/member-transactions";
import Tooltip from "@/components/Tooltip";
import BillingIssuesTable from "./BillingIssuesTable";
import HubStatusSelect from "./HubStatusSelect";

const BASE = "/admin/hygiene/billing-reconciliation";

/** The page for a group (or an old narrower filter id, kept as it was typed) and a Hub status. */
function hrefFor(filter: string | null, hub: HubStatusFilterId): string {
  const query = new URLSearchParams();
  if (filter) query.set("filter", filter);
  if (hub !== "all") query.set("hub", hub);
  const text = query.toString();
  return text ? `${BASE}?${text}` : BASE;
}

/**
 * The summary, a handful of "what do I do" groups plus a Hub status, and every schedule row that needs a look as one
 * table row (`BillingIssuesTable`): what is at stake, how long it has waited, and the Stripe transactions behind it.
 * The filter and the Hub status live in the URL; counts are rows, not members.
 */
export default function BillingOverview({ overview, filter, hub }: { overview: Overview; filter?: string; hub?: string }) {
  if (overview.counts.invoices === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No Stripe invoices are imported yet, so there is nothing to line up.</p>;
  }

  const issues = buildIssues(overview);
  const chosen: IssueFilter = parseIssueFilter(filter);
  const hubId = parseHubStatusFilter(hub);
  const shown = selectIssues(issues, { filter: chosen, hub: hubId });
  const totals = issueTotals(shown);
  const groupLabel = chosen.legacy?.label ?? ISSUE_GROUPS.find((g) => g.id === chosen.group)?.label ?? "All";
  const money = totals.byCurrency.map((m) => formatCents(m.cents, m.currency)).join(" + ") || formatCents(0, "usd");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const chips = [{ id: null, label: "All", hint: undefined, count: issuesIn(issues, null, hubId).length }, ...ISSUE_GROUPS.map((g) => ({ id: g.id as string, label: g.label, hint: g.hint as string | undefined, count: issuesIn(issues, g.id, hubId).length }))];
  const activeChip = chosen.legacy ? undefined : (chosen.group ?? null);
  const filterId = chosen.legacy?.id ?? chosen.group;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {overview.counts.linkedMembers} members with a Stripe customer, {overview.counts.invoices} invoices and {overview.counts.purchases} event, program and course purchases, as of {overview.today}.
      </p>

      {overview.counts.unrecognisedKajabiCharges > 0 && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {plural(overview.counts.unrecognisedKajabiCharges, "Stripe charge has", "Stripe charges have")} Kajabi metadata in a shape this page does not recognise, so their purchases may show as missing a payment.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
          {chips.map((c) => (
            <Tooltip key={c.id ?? "all"} content={c.hint}>
              <Link
                href={hrefFor(c.id, hubId)}
                aria-current={c.id === activeChip ? "page" : undefined}
                className={`rounded-full border px-3 py-1 ${c.id === activeChip ? "bg-plum-600 text-white border-plum-600" : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"}`}
              >
                {c.label} ({c.count})
              </Link>
            </Tooltip>
          ))}
        </nav>
        <HubStatusSelect
          value={hubId}
          options={HUB_STATUS_FILTERS.map((f) => ({
            id: f.id,
            label: `${f.label} (${selectIssues(issues, { filter: chosen, hub: f.id }).length})`,
            href: hrefFor(filterId, f.id),
          }))}
        />
      </div>

      {chosen.legacy && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Narrowed to &ldquo;{chosen.legacy.label}&rdquo;.{" "}
          <Link href={hrefFor(null, hubId)} className="text-plum-600 hover:underline dark:text-plum-400">
            Show all
          </Link>
        </p>
      )}

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Needs a look: {groupLabel}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="issue-totals">
            <strong className={totals.rows > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"}>{plural(totals.rows, "issue", "issues")}</strong> for {plural(totals.members, "member", "members")}, {money} at stake
          </p>
        </div>
        <BillingIssuesTable
          issues={shown}
          resetKey={`${filterId ?? ""}|${hubId}`}
          emptyText={chosen.group === null && !chosen.legacy && hubId === "all" ? "Every billing day lines up." : "Nothing here."}
        />
      </section>
    </div>
  );
}

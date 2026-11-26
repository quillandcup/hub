"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import Tooltip from "@/components/Tooltip";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import { STATUS_CLASS } from "@/components/BillingSchedule";
import TableKeyboardNav from "@/components/TableKeyboardNav";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { ISSUE_GROUPS, type Issue } from "@/lib/billing-issues";
import { formatCents } from "@/lib/member-transactions";

type Column = "member" | "purchase" | "issue" | "amount" | "age" | "hub";

const HEAD = "px-4 py-3 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider";
const LINK = "text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline";
const MUTED = "block text-xs text-slate-500 dark:text-slate-400";
const COLUMN_COUNT = 7;

const transactionsHref = (memberId: string) => `/admin/members/${memberId}/transactions`;
const groupLabel = (id: Issue["group"]) => ISSUE_GROUPS.find((g) => g.id === id)?.label ?? "";
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function sortValue(issue: Issue, column: Column) {
  switch (column) {
    case "member":
      return issue.memberName.toLowerCase();
    case "purchase":
      return issue.purchaseLabel.toLowerCase();
    case "issue":
      return issue.statusLabel;
    case "amount":
      return issue.amountCents;
    case "age":
      return issue.ageDays;
    case "hub":
      return issue.hubStatusLabel;
  }
}

const searchText = (issue: Issue) =>
  [issue.memberName, issue.legalName ?? "", issue.purchaseLabel, issue.offerName ?? "", issue.event?.title ?? "", issue.statusLabel, groupLabel(issue.group), issue.hubStatusLabel, issue.reason].join(" ");

function IssueDetail({ issue }: { issue: Issue }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-800 dark:text-slate-200">{issue.reason}</p>
      {issue.transactions.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No Stripe invoice or payment is behind this row.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label={`Transactions for ${issue.memberName}`}>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Tries</th>
                <th className="px-3 py-2 font-medium">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {issue.transactions.map((t) => (
                <tr key={t.id} className="border-t border-slate-200 align-top dark:border-slate-700">
                  <td className="whitespace-nowrap px-3 py-2">{t.day}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {formatCents(t.keptCents > 0 ? t.keptCents : t.billedCents, issue.currency)}
                    {t.refundedCents > 0 && <span className={MUTED}>{formatCents(t.refundedCents, issue.currency)} refunded</span>}
                  </td>
                  <td className="px-3 py-2">
                    {t.statusLabel}
                    {t.failureCodes.length > 0 && <span className={MUTED}>{t.failureCodes.map((c) => c.replace(/_/g, " ")).join(", ")}</span>}
                  </td>
                  <td className="px-3 py-2">{t.attempts > 0 ? t.attempts : ""}</td>
                  <td className="px-3 py-2">
                    <a href={t.stripeUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 ${LINK}`}>
                      {t.id}
                      <Icon name="external" className="h-3.5 w-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link href={transactionsHref(issue.memberId)} className={`inline-block text-sm ${LINK}`}>
        Open member&apos;s transactions
      </Link>
    </div>
  );
}

/**
 * The issues as the standard admin table: one row per schedule row that needs a look, sortable on every column,
 * searchable, paged, with the shared keyboard keys. A row opens to the full sentence and its Stripe transactions.
 * `issues` arrive most urgent first; that order is the table's own until a header is clicked.
 */
export default function BillingIssuesTable({ issues, resetKey, emptyText }: { issues: Issue[]; resetKey: string; emptyText: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const table = useDataTable<Issue, Column>({ rows: issues, resetKey, search: searchText, getSortValue: sortValue, defaultSort: null });

  if (issues.length === 0) {
    return <div className="px-6 py-8 text-center text-sm font-medium text-green-700 dark:text-green-400">{emptyText}</div>;
  }

  return (
    <div className="space-y-3 p-4">
      <DataTableSearch table={table} label="Search members, issues and reasons" />
      <TableKeyboardNav table={table} label="Billing issues">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="w-10 px-2 py-3">
                  <span className="sr-only">Details</span>
                </th>
                <SortableTh label="Member" className={HEAD} {...table.sortProps("member")} />
                <SortableTh label="Purchase" className={HEAD} {...table.sortProps("purchase")} />
                <SortableTh label="Issue" className={HEAD} {...table.sortProps("issue")} />
                <SortableTh label="Amount" align="right" className={HEAD} {...table.sortProps("amount")} />
                <SortableTh label="Age" className={HEAD} {...table.sortProps("age")} />
                <SortableTh label="Hub status" className={HEAD} {...table.sortProps("hub")} />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((issue) => {
                const expanded = open.has(issue.key);
                const detailId = `billing-issue-${issue.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
                const name = `${expanded ? "Hide" : "Show"} details for ${issue.memberName}: ${issue.statusLabel}`;
                return (
                  <Fragment key={issue.key}>
                    <tr className="border-t border-slate-200 align-top dark:border-slate-800">
                      <td className="px-2 py-3">
                        <Tooltip content={expanded ? "Hide details" : "Show details"}>
                          <button
                            type="button"
                            aria-label={name}
                            aria-expanded={expanded}
                            aria-controls={expanded ? detailId : undefined}
                            onClick={() => toggle(issue.key)}
                            className="rounded p-1 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <Icon name="chevron" className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                          </button>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={transactionsHref(issue.memberId)} className={LINK}>
                          {issue.memberName}
                        </Link>
                        {issue.legalName && <span className={MUTED}>{issue.legalName}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {issue.event ? (
                          <Link href={`/admin/events/${issue.event.slug}`} className={LINK}>
                            {issue.event.title}
                          </Link>
                        ) : (
                          issue.purchaseLabel
                        )}
                        {issue.offerName && <span className={MUTED}>{issue.offerName}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[issue.status]}`}>{issue.statusLabel}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{issue.amountCents === null ? "" : formatCents(issue.amountCents, issue.currency)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {issue.ageDays === null ? "" : issue.ageDays === 0 ? "Today" : plural(issue.ageDays)}
                        {issue.sinceDay && <span className={MUTED}>since {issue.sinceDay}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{issue.hubStatusLabel}</td>
                    </tr>
                    {expanded && (
                      <tr id={detailId} data-kbd-skip className="bg-slate-50 dark:bg-slate-800/50">
                        <td />
                        <td colSpan={COLUMN_COUNT - 1} className="px-4 py-3">
                          <IssueDetail issue={issue} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataTablePager table={table} itemLabel="issues" />
      </TableKeyboardNav>
    </div>
  );
}

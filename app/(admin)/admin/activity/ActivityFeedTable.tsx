"use client";

import Link from "next/link";
import { DataTablePager } from "@/components/DataTablePager";
import { useServerDataTable } from "@/lib/hooks/useDataTable";
import { formatDateTime } from "@/lib/formatters";
import {
  actorDisplay,
  changedFields,
  describeRow,
  feedSearch,
  formatValue,
  type ActivityFeedRow,
  type FeedFilters,
} from "@/lib/activity-feed";

const ACTOR_BADGE: Record<ActivityFeedRow["actor_kind"], string> = {
  staff: "bg-plum-100 text-plum-800 dark:bg-plum-900/30 dark:text-plum-300",
  member: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  system: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function ChangeTable({ row }: { row: ActivityFeedRow }) {
  const fields = changedFields(row.data);
  if (fields.length === 0) return null;
  return (
    <table className="mt-2 text-xs w-full max-w-3xl">
      <tbody>
        {fields.map(([field, change]) => (
          <tr key={field} className="border-t border-slate-100 dark:border-slate-800 align-top">
            <td className="py-1 pr-3 font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
              {field.replace(/_/g, " ")}
            </td>
            <td className="py-1 pr-2 text-slate-500 line-through break-all">
              {row.event_type === "insert" ? "" : formatValue(change.old)}
            </td>
            <td className="py-1 text-slate-900 dark:text-slate-100 break-all">
              {row.event_type === "delete" ? "" : formatValue(change.new)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PageTrail({ row }: { row: ActivityFeedRow }) {
  const pages = Array.isArray(row.data?.pages) ? (row.data.pages as string[]) : [];
  if (pages.length === 0) return null;
  return (
    <ol className="mt-2 text-xs text-slate-600 dark:text-slate-400 list-decimal list-inside space-y-0.5 font-mono">
      {pages.map((p, i) => (
        <li key={i}>{p}</li>
      ))}
    </ol>
  );
}

function hasDetail(row: ActivityFeedRow) {
  return (
    (row.kind === "audit" && changedFields(row.data).length > 0) ||
    (row.kind === "session" && Array.isArray(row.data?.pages) && row.data.pages.length > 0) ||
    (row.kind === "activity" && !!row.description)
  );
}

/**
 * The activity log table in server mode: `rows` is the one page the server
 * filtered and ranged; the pager updates ?page=&pageSize= in the URL, which the
 * page reads back. Clicking a name filters to that actor.
 */
export default function ActivityFeedTable({
  rows,
  total,
  page,
  pageSize,
  filters,
}: {
  rows: ActivityFeedRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: FeedFilters;
}) {
  // Newest first is the only order; there are no sortable columns.
  const table = useServerDataTable<ActivityFeedRow, never>({
    rows,
    total,
    page,
    pageSize,
    allowed: [],
    defaultSort: null,
  });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 pr-4 font-medium whitespace-nowrap">When</th>
              <th className="py-2 pr-4 font-medium">Who</th>
              <th className="py-2 pr-4 font-medium">What</th>
              <th className="py-2 font-medium">About</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => {
              const sudo = !!row.acting_as_member_id;
              return (
                <tr key={row.event_id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                    <time dateTime={row.occurred_at}>{formatDateTime(row.occurred_at)}</time>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-2 ${ACTOR_BADGE[row.actor_kind]}`}
                    >
                      {sudo ? "sudo" : row.actor_kind}
                    </span>
                    {row.actor_user_id ? (
                      <Link
                        href={`/admin/activity${feedSearch({ ...filters, actorUserId: row.actor_user_id })}`}
                        className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
                      >
                        {actorDisplay(row)}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900 dark:text-slate-100">{actorDisplay(row)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                    {hasDetail(row) ? (
                      <details>
                        <summary className="cursor-pointer">{describeRow(row)}</summary>
                        {row.kind === "audit" && <ChangeTable row={row} />}
                        {row.kind === "session" && <PageTrail row={row} />}
                        {row.kind === "activity" && row.description && (
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                            {row.description}
                          </p>
                        )}
                      </details>
                    ) : (
                      describeRow(row)
                    )}
                  </td>
                  <td className="py-2">
                    {row.member_id && row.member_name ? (
                      <Link
                        href={`/admin/members/${row.member_id}`}
                        className="text-plum-600 dark:text-plum-400 hover:underline"
                      >
                        {row.member_name}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DataTablePager table={table} itemLabel="events" />
    </div>
  );
}

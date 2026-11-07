"use client";

import Link from "next/link";
import { activityLink } from "@/lib/activity-links";
import ReactionEmoji from "@/components/ReactionEmoji";
import type { ReactionEmojiValue } from "@/lib/slack-reaction-emoji";
import { DataTablePager } from "@/components/DataTablePager";
import { useServerDataTable } from "@/lib/hooks/useDataTable";
import { formatDateTime } from "@/lib/formatters";
import { useTimeZone } from "@/components/Timezone";
import NoteEntry, { type NoteControls } from "./NoteEntry";
import { detailLines, type ResolvedValue } from "@/lib/audit-details";
import {
  actorDisplay,
  describeRow,
  emailLinkOf,
  reactionName,
  feedSearch,
  summarizePages,
  type ActivityFeedRow,
  type FeedFilters,
} from "@/lib/activity-feed";

const ACTOR_BADGE: Record<ActivityFeedRow["actor_kind"], string> = {
  staff: "bg-plum-100 text-plum-800 dark:bg-plum-900/30 dark:text-plum-300",
  member: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  system: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

/**
 * The details of an audit row as a definition list: label above value on a phone, label beside value from
 * `sm`, so a long value gets the full width instead of wrapping per character in a sliver of a column.
 */
export function ChangeTable({ row }: { row: ActivityFeedRow }) {
  const lines = detailLines(row);
  if (lines.length === 0) return null;
  const show = (v: ResolvedValue | null) =>
    v === null ? "" : v.href ? (
      <Link href={v.href} className="text-plum-600 hover:underline dark:text-plum-400">
        {v.text}
      </Link>
    ) : (
      v.text
    );
  return (
    <div className="@container">
    <dl className="mt-2 w-full max-w-3xl text-xs">
      {lines.map((l) => (
        <div key={l.field} className="grid gap-x-3 gap-y-0.5 border-t border-slate-100 py-1.5 dark:border-slate-800 @pair:grid-cols-[10rem_1fr]">
          <dt className="font-medium capitalize text-slate-600 dark:text-slate-400">{l.label}</dt>
          <dd className="min-w-0 break-words text-slate-900 dark:text-slate-100">
            {row.event_type !== "insert" && l.old && <span className="mr-2 text-slate-600 line-through dark:text-slate-400">{show(l.old)}</span>}
            {row.event_type !== "delete" && show(l.new)}
          </dd>
        </div>
      ))}
    </dl>
    </div>
  );
}

function PageTrail({ row }: { row: ActivityFeedRow }) {
  const pages = Array.isArray(row.data?.pages) ? (row.data.pages as string[]) : [];
  if (pages.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
      <ul className="space-y-0.5">
        {summarizePages(pages).map(({ label, count }) => (
          <li key={label}>
            {label} <span className="text-slate-500 dark:text-slate-400">×{count}</span>
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer text-slate-600 dark:text-slate-400">In order</summary>
        <ol className="mt-1 list-decimal list-inside space-y-0.5 font-mono">
          {pages.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** A reaction reads "Reacted 🎉" (or the custom emoji's image); everything else is describeRow's sentence. */
function Summary({ row }: { row: ActivityFeedRow }) {
  const name = reactionName(row);
  if (!name) return <>{describeRow(row)}</>;
  return (
    <>
      Reacted <ReactionEmoji name={name} emoji={row.data?.reaction_emoji as ReactionEmojiValue | undefined} />
    </>
  );
}

/** A link to the row's source (the prickle, the member, the feedback) when it has a page. */
function SourceLink({ row }: { row: ActivityFeedRow }) {
  const link = activityLink(row);
  if (!link) return null;
  return (
    <>
      {" "}
      <Link href={link.href} data-track="activity-open-source" className="whitespace-nowrap text-plum-600 hover:underline dark:text-plum-400">
        {link.label} →
      </Link>
    </>
  );
}

function hasDetail(row: ActivityFeedRow) {
  return (
    (row.kind === "audit" && detailLines(row).length > 0) ||
    (row.kind === "session" && Array.isArray(row.data?.pages) && row.data.pages.length > 0) ||
    (row.kind === "activity" && (!!row.description || !!emailLinkOf(row.data)))
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
  hideAbout = false,
  noteControls,
}: {
  rows: ActivityFeedRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: FeedFilters;
  /** Drop the About column, where every row is about the same member (their own page). */
  hideAbout?: boolean;
  /** On a member's own page: lets the note rows be edited (their author, for a while) and deleted. */
  noteControls?: NoteControls;
}) {
  const timeZone = useTimeZone();
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
            <tr className="text-left text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 pr-4 font-medium whitespace-nowrap">When</th>
              <th className="py-2 pr-4 font-medium">Who</th>
              <th className="py-2 pr-4 font-medium">What</th>
              {!hideAbout && <th className="py-2 font-medium">About</th>}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => {
              const sudo = !!row.acting_as_member_id;
              return (
                <tr key={row.event_id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                    <time dateTime={row.occurred_at}>{formatDateTime(row.occurred_at, timeZone)}</time>
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
                    {row.kind === "note" ? (
                      <NoteEntry row={row} controls={noteControls} />
                    ) : hasDetail(row) ? (
                      <>
                      <details>
                        <summary className="cursor-pointer"><Summary row={row} /></summary>
                        {row.kind === "audit" && <ChangeTable row={row} />}
                        {row.kind === "session" && <PageTrail row={row} />}
                        {row.kind === "activity" && row.description && (
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                            {row.description}
                          </p>
                        )}
                        {row.kind === "activity" && emailLinkOf(row.data) && (
                          <p className="mt-2 text-sm">
                            <a
                              href={emailLinkOf(row.data)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-track="activity-email-open-in-resend"
                              className="text-plum-600 dark:text-plum-400 hover:underline"
                            >
                              Read this email at Resend
                            </a>
                          </p>
                        )}
                      </details>
                      <SourceLink row={row} />
                      </>
                    ) : (
                      <>
                        <Summary row={row} />
                        <SourceLink row={row} />
                      </>
                    )}
                  </td>
                  {!hideAbout && (
                    <td className="py-2">
                      {row.actor_kind === "member" && !sudo ? (
                        <span className="text-slate-500 dark:text-slate-400">self</span>
                      ) : row.member_id && row.member_name ? (
                        <Link
                          href={`/admin/members/${row.member_id}`}
                          className="text-plum-600 dark:text-plum-400 hover:underline"
                        >
                          {row.member_name}
                        </Link>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">—</span>
                      )}
                    </td>
                  )}
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

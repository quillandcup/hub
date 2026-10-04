"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInAppNotifications } from "@/components/InAppNotifications";
import { SortableTh } from "@/components/SortableTh";
import { DataTablePager } from "@/components/DataTablePager";
import { useServerDataTable } from "@/lib/hooks/useDataTable";
import { formatRelativeTime } from "@/lib/formatters";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";
import {
  DEFAULT_INBOX_SORT,
  INBOX_FILTERS,
  INBOX_SORT_COLUMNS,
  notificationKindLabel,
  type InboxFilter,
  type InboxSortColumn,
} from "@/lib/notifications/inbox";
import type { InAppNotification, InboxPage } from "@/lib/channels/in-app";

/**
 * The inbox table in server mode: `inbox` is the one page the server filtered, sorted and ranged;
 * the filter tabs, type picker, header clicks and pager update the URL, which the page reads back.
 * Marking read goes through the layout's InAppNotificationsProvider, so the bell's count follows.
 */
export default function NotificationInbox({
  inbox,
  filter,
  kind,
}: {
  inbox: InboxPage;
  filter: InboxFilter;
  kind: string | null;
}) {
  const { error, markRead, markAllRead } = useInAppNotifications();
  const [items, setItems] = useState(inbox.items);
  const [unread, setUnread] = useState(inbox.counts.unread);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const table = useServerDataTable<InAppNotification, InboxSortColumn>({
    rows: items,
    total: inbox.total,
    page: inbox.page,
    pageSize: inbox.pageSize,
    allowed: INBOX_SORT_COLUMNS,
    defaultSort: DEFAULT_INBOX_SORT,
  });

  // A new filter or type starts on page 1.
  function setParam(name: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function open(n: InAppNotification) {
    if (n.read) return;
    setItems((list) => list.map((m) => (m.id === n.id ? { ...m, read: true } : m)));
    setUnread((c) => Math.max(0, c - 1));
    if (!(await markRead([n.id]))) {
      setItems((list) => list.map((m) => (m.id === n.id ? { ...m, read: false } : m)));
      setUnread((c) => c + 1);
    }
  }

  async function readAll() {
    const before = { items, unread };
    setItems((list) => list.map((m) => ({ ...m, read: true })));
    setUnread(0);
    if (await markAllRead()) router.refresh();
    else {
      setItems(before.items);
      setUnread(before.unread);
    }
  }

  const counts = { ...inbox.counts, unread };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {INBOX_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setParam("filter", f.value === "all" ? null : f.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-plum-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {f.label} <span className="opacity-70">({counts[f.value]})</span>
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
          <span>Type</span>
          <select
            value={kind ?? ""}
            onChange={(e) => setParam("kind", e.target.value || null)}
            className="px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="">All types</option>
            {NOTIFICATION_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={readAll}
          disabled={unread === 0}
          className="ml-auto text-sm text-plum-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-plum-400"
        >
          Mark all as read
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="w-8 px-4 py-3">
                <span className="sr-only">Unread</span>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Notification
              </th>
              <SortableTh label="Type" {...table.sortProps("kind")} />
              <SortableTh label="Received" {...table.sortProps("created_at")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                  {filter === "unread" ? "Nothing unread." : "No notifications yet."}
                </td>
              </tr>
            ) : (
              table.rows.map((n) => (
                <tr key={n.id} className={n.read ? "" : "bg-plum-50/60 dark:bg-plum-950/60"}>
                  <td className="px-4 py-3">
                    {!n.read && <span aria-label="Unread" className="block h-2 w-2 rounded-full bg-plum-600" />}
                  </td>
                  <td className="px-6 py-3">
                    {n.url ? (
                      <Link
                        href={n.url}
                        onClick={() => open(n)}
                        className={`hover:underline ${n.read ? "text-slate-600 dark:text-slate-400" : "font-medium text-slate-900 dark:text-slate-100"}`}
                      >
                        {n.text}
                      </Link>
                    ) : (
                      <span className={n.read ? "text-slate-600 dark:text-slate-400" : "font-medium text-slate-900 dark:text-slate-100"}>
                        {n.text}
                      </span>
                    )}
                    {!n.read && !n.url && (
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className="ml-2 text-xs text-plum-600 hover:underline dark:text-plum-400"
                      >
                        Mark read
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-slate-600 dark:text-slate-400">
                    {notificationKindLabel(n.kind)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-slate-500 dark:text-slate-400">
                    <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()} suppressHydrationWarning>
                      {formatRelativeTime(n.createdAt)}
                    </time>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <DataTablePager table={table} itemLabel="notifications" />
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInAppNotifications } from "@/components/InAppNotifications";
import { SortableTh } from "@/components/SortableTh";
import { DataTablePager } from "@/components/DataTablePager";
import { BulkActionBar, BulkActionButton } from "@/components/BulkActionBar";
import { useRowSelection } from "@/lib/hooks/useRowSelection";
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
 * Rows can be selected for bulk Mark as read / Mark as unread, and each row has its own toggle.
 * Marking goes through the layout's InAppNotificationsProvider, so the bell's count follows.
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
  const { error, markRead, markUnread, markAllRead } = useInAppNotifications();
  const [items, setItems] = useState(inbox.items);
  const [unread, setUnread] = useState(inbox.counts.unread);
  const rowIds = useMemo(() => items.map((n) => n.id), [items]);
  const selection = useRowSelection(rowIds);
  // The checkboxes only show in "Edit multiple" mode.
  const [editing, setEditing] = useState(false);
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

  // Sets these notifications' read state: optimistic, put back if the save fails.
  async function setRead(ids: string[], read: boolean) {
    const changing = items.filter((n) => ids.includes(n.id) && n.read !== read);
    if (changing.length === 0) return true;
    const changedIds = changing.map((n) => n.id);
    const delta = read ? -changing.length : changing.length;
    setItems((list) => list.map((m) => (changedIds.includes(m.id) ? { ...m, read } : m)));
    setUnread((c) => Math.max(0, c + delta));
    const saved = await (read ? markRead(changedIds) : markUnread(changedIds));
    if (!saved) {
      setItems((list) => list.map((m) => (changedIds.includes(m.id) ? { ...m, read: !read } : m)));
      setUnread((c) => Math.max(0, c - delta));
    }
    return saved;
  }

  function toggleEditing() {
    selection.clear();
    setEditing((e) => !e);
  }

  function open(n: InAppNotification) {
    if (!n.read) setRead([n.id], true);
  }

  async function bulk(read: boolean) {
    if (await setRead([...selection.selectedIds], read)) selection.clear();
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
          onClick={toggleEditing}
          aria-pressed={editing}
          className="ml-auto text-sm text-plum-600 hover:underline dark:text-plum-400"
        >
          {editing ? "Done" : "Edit multiple"}
        </button>
        <button
          type="button"
          onClick={readAll}
          disabled={unread === 0}
          className="text-sm text-plum-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-plum-400"
        >
          Mark all as read
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <BulkActionBar count={editing ? selection.selectedIds.size : 0} onClear={selection.clear}>
          <BulkActionButton onClick={() => bulk(true)}>Mark as read</BulkActionButton>
          <BulkActionButton onClick={() => bulk(false)}>Mark as unread</BulkActionButton>
        </BulkActionBar>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {editing && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selection.allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selection.someSelected;
                      }}
                      onChange={selection.toggleAll}
                      disabled={items.length === 0}
                      className="cursor-pointer accent-plum-600"
                      aria-label="Select all on this page"
                    />
                  </th>
                )}
                <th className="w-8 px-2 py-3">
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
                  <td colSpan={editing ? 5 : 4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                    {filter === "unread" ? "Nothing unread." : "No notifications yet."}
                  </td>
                </tr>
              ) : (
                table.rows.map((n) => (
                  <tr key={n.id} className={`${n.read ? "" : "bg-plum-50/60 dark:bg-plum-950/60"}`}>
                    {editing && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selection.isSelected(n.id)}
                          onChange={() => selection.toggle(n.id)}
                          className="cursor-pointer accent-plum-600"
                          aria-label={`Select: ${n.text}`}
                        />
                      </td>
                    )}
                    <td className="px-2 py-3">
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
                        <span
                          className={
                            n.read
                              ? "text-slate-600 dark:text-slate-400"
                              : "font-medium text-slate-900 dark:text-slate-100"
                          }
                        >
                          {n.text}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setRead([n.id], !n.read)}
                        className="ml-2 text-xs text-plum-600 hover:underline dark:text-plum-400"
                      >
                        {n.read ? "Mark unread" : "Mark read"}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-slate-600 dark:text-slate-400">
                      {notificationKindLabel(n.kind)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-slate-500 dark:text-slate-400">
                      <time
                        dateTime={n.createdAt}
                        title={new Date(n.createdAt).toLocaleString()}
                        suppressHydrationWarning
                      >
                        {formatRelativeTime(n.createdAt)}
                      </time>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <DataTablePager table={table} itemLabel="notifications" />
      </div>
    </div>
  );
}

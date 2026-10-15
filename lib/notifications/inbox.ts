import type { SortConfig } from "@/lib/hooks/useTableSort";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";

/**
 * The /notifications inbox table's options, shared by the server page (which reads them from the
 * URL and queries) and the client table. Client-safe. The query is loadInboxPage in
 * lib/channels/in-app.ts.
 */

export const INBOX_SORT_COLUMNS = ["created_at", "kind"] as const;
export type InboxSortColumn = (typeof INBOX_SORT_COLUMNS)[number];
export const DEFAULT_INBOX_SORT: SortConfig<InboxSortColumn> = { column: "created_at", direction: "desc" };

export const INBOX_FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number]["value"];
export type InboxFilterCounts = Record<InboxFilter, number>;

export function parseInboxFilter(value: string | string[] | undefined): InboxFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return INBOX_FILTERS.some((f) => f.value === v) ? (v as InboxFilter) : "all";
}

/** A known notification kind from ?kind=, or null for every kind. */
export function parseInboxKind(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return NOTIFICATION_KINDS.some((k) => k.id === v) ? (v as string) : null;
}

/** A kind's label, or its id for one no longer in the registry. */
export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

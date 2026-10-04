import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { loadInboxPage } from "@/lib/channels/in-app";
import { parsePageParam, parsePageSizeParam, parseSortParams } from "@/lib/pagination";
import { DEFAULT_INBOX_SORT, INBOX_SORT_COLUMNS, parseInboxFilter, parseInboxKind } from "@/lib/notifications/inbox";
import NotificationInbox from "./NotificationInbox";

export const metadata: Metadata = {
  title: "Notifications",
};

type Param = string | string[] | undefined;

/**
 * Every in-app notification the member has had (lib/channels/in-app.ts), as a server-mode data
 * table like All Members: ?filter= (all/unread), ?kind=, ?sort=&dir=, ?page=&pageSize=, with
 * "Mark all as read". The bell shows only the latest few and links here. Behind the
 * in_app_notifications flag; hidden in sudo, like the bell.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: Param; kind?: Param; sort?: Param; dir?: Param; page?: Param; pageSize?: Param }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");
  if (!(await getUserFeaturePreviews(user.id)).includes("in_app_notifications")) notFound();

  if (identity.isSudo) {
    return (
      <div className="container mx-auto px-6 py-6 max-w-4xl">
        <h1 className="text-2xl font-bold mb-4">Notifications</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A member&apos;s notifications are their own, so they&apos;re hidden while browsing as them.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const filter = parseInboxFilter(params.filter);
  const kind = parseInboxKind(params.kind);
  const inbox = await loadInboxPage(await createClient(), identity.memberId, new Date(), {
    filter,
    kind,
    sort: parseSortParams(params.sort, params.dir, INBOX_SORT_COLUMNS, DEFAULT_INBOX_SORT) ?? DEFAULT_INBOX_SORT,
    page: parsePageParam(params.page),
    pageSize: parsePageSizeParam(params.pageSize),
  });

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Notifications</h1>
      <NotificationInbox key={inbox.items.map((n) => n.id).join(",")} inbox={inbox} filter={filter} kind={kind} />
    </div>
  );
}

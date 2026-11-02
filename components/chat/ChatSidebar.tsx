"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authenticateRealtime } from "@/lib/chat/live";
import { loadUnreadCounts, type ChannelSummary } from "@/lib/chat/load";
import { LAST_CHAT_COOKIE } from "@/lib/chat/last-channel";
import { syncChatReadFromSlack } from "@/app/(member)/chat/actions";

/** A badge reads 99+ beyond that; the server stops counting at 100. */
const badge = (n: number) => (n > 99 ? "99+" : String(n));

/** Most conversations with unread messages prefetched in full per section, so a busy member doesn't render dozens at once. */
const MAX_UNREAD_PREFETCH = 5;

/** How long deletes in a conversation are batched before its count is re-read. */
const DELETE_RECOUNT_MS = 300;

/**
 * One conversation in the list. The default link prefetch stops at the loading skeleton (the page is
 * dynamic), so a click still waits for the server. Prefetching every link in full would render every
 * conversation on each load, so only the ones the member is about to open are: one with unread
 * messages, or one being hovered, focused or touched. That fills the router's cache (5 minutes), and
 * a conversation opened from it catches itself up (`ChatLive`). Prefetching only happens in production.
 */
function ChannelLink({ href, hasUnread, ...props }: React.ComponentProps<typeof Link> & { href: string; hasUnread: boolean }) {
  const [warm, setWarm] = useState(false);
  const heat = () => setWarm(true);
  return <Link {...props} href={href} prefetch={warm || hasUnread ? true : undefined} onPointerEnter={heat} onFocus={heat} onTouchStart={heat} />;
}

function Section({
  title,
  channels,
  pathname,
  unread,
}: {
  title: string;
  channels: ChannelSummary[];
  pathname: string;
  unread: Record<string, number>;
}) {
  if (channels.length === 0) return null;
  const prefetched = new Set(channels.filter((c) => c.id !== pathname.split("/")[2] && (unread[c.id] ?? 0) > 0).slice(0, MAX_UNREAD_PREFETCH).map((c) => c.id));
  return (
    <div className="mb-4">
      <h2 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1 px-3">{title}</h2>
      <ul className="space-y-0.5">
        {channels.map((c) => {
          const active = pathname === `/chat/${c.id}`;
          const count = active ? 0 : (unread[c.id] ?? 0);
          return (
            <li key={c.id}>
              <ChannelLink
                href={`/chat/${c.id}`}
                hasUnread={prefetched.has(c.id)}
                data-track="chat-sidebar-channel"
                aria-current={active ? "page" : undefined}
                aria-label={count > 0 ? `${c.label}, ${badge(count)} unread` : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-plum-50 dark:bg-plum-900/20 text-plum-600 dark:text-plum-400 font-medium"
                    : count > 0
                      ? "font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {c.kind === "channel" &&
                  (c.visibility === "private" ? (
                    <svg role="img" aria-label="Private channel" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="7" width="10" height="7" rx="1.5" />
                      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                    </svg>
                  ) : (
                    <span className="w-3.5 shrink-0 text-center">#</span>
                  ))}
                <span className="truncate">{c.kind === "channel" ? c.label.replace(/^#/, "") : c.label}</span>
                {count > 0 && (
                  <span aria-hidden="true" className="ml-auto rounded-full bg-plum-600 px-1.5 text-xs font-medium text-white">
                    {badge(count)}
                  </span>
                )}
              </ChannelLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The unread map the sidebar shows. It starts from what the server counted for this page, adds a
 * message as it arrives in a conversation that isn't open (over Realtime, which applies the
 * member's RLS), and zeroes a conversation once it is opened (the page marks it read). It starts
 * over from the server's numbers whenever those change, as after a page refresh. The layout does
 * not re-run on client navigation, so this state is what keeps the numbers right between loads.
 */
function useUnreadCounts(
  fromServer: Record<string, number>,
  activeId: string | null,
  selfMemberId: string | null,
  channels: ChannelSummary[]
): Record<string, number> {
  const signature = JSON.stringify(fromServer);
  const [seen, setSeen] = useState(signature);
  const [counts, setCounts] = useState(fromServer);
  const [lastActive, setLastActive] = useState<string | null>(null);
  if (signature !== seen) {
    setSeen(signature);
    setCounts(fromServer);
  }
  if (activeId !== lastActive) {
    setLastActive(activeId);
    // Opening a conversation reads it; leaving it marks it read through what was on screen.
    const cleared = [activeId, lastActive].filter((id): id is string => id !== null);
    if (cleared.length > 0) setCounts((c) => ({ ...c, ...Object.fromEntries(cleared.map((id) => [id, 0])) }));
  }

  // Read through refs so the subscription is not rebuilt on every navigation.
  const active = useRef(activeId);
  const joined = useRef(new Set<string>());
  useEffect(() => {
    active.current = activeId;
    joined.current = new Set(channels.filter((c) => c.joined && !c.archived).map((c) => c.id));
  });

  useEffect(() => {
    if (!selfMemberId) return;
    const supabase = createClient();
    let cancelled = false;
    let subscription: ReturnType<typeof supabase.channel> | null = null;
    const stale = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      await authenticateRealtime(supabase);
      if (cancelled) return;
      subscription = supabase
        .channel("chat:unread")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
          const row = payload.new as { channel_id: string; thread_root_id: string | null; author_member_id: string | null; deleted_at: string | null };
          if (row.thread_root_id || row.deleted_at || row.author_member_id === selfMemberId) return;
          if (row.channel_id === active.current || !joined.current.has(row.channel_id)) return;
          setCounts((c) => ({ ...c, [row.channel_id]: Math.min((c[row.channel_id] ?? 0) + 1, 100) }));
        })
        // A delete is an update that sets deleted_at. The row does not say whether we counted it
        // (the old row is not sent), so ask the server for those conversations' counts once things
        // settle; setting rather than decrementing makes repeats and already-read deletes harmless.
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, (payload) => {
          const row = payload.new as { channel_id: string; thread_root_id: string | null; author_member_id: string | null; deleted_at: string | null };
          if (!row.deleted_at || row.thread_root_id || row.author_member_id === selfMemberId) return;
          if (row.channel_id === active.current || !joined.current.has(row.channel_id)) return;
          stale.add(row.channel_id);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            const ids = [...stale];
            stale.clear();
            void loadUnreadCounts(supabase)
              .then((fresh) => {
                if (cancelled) return;
                setCounts((c) => ({
                  ...c,
                  ...Object.fromEntries(ids.filter((id) => id !== active.current).map((id) => [id, fresh[id] ?? 0])),
                }));
              })
              .catch(() => {});
          }, DELETE_RECOUNT_MS);
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (subscription) void supabase.removeChannel(subscription);
    };
  }, [selfMemberId]);

  // Catch up with what the member read in Slack when they open chat and whenever they come back to
  // this window (from Slack, say). The server answers with fresh counts, or nothing when the member
  // hasn't connected Slack or asked a moment ago.
  useEffect(() => {
    if (!selfMemberId) return;
    let cancelled = false;
    const pull = () => {
      if (document.visibilityState !== "visible") return;
      void syncChatReadFromSlack(active.current)
        .then((fresh) => {
          if (!cancelled && fresh) setCounts(fresh);
        })
        .catch(() => {});
    };
    pull();
    document.addEventListener("visibilitychange", pull);
    window.addEventListener("focus", pull);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", pull);
      window.removeEventListener("focus", pull);
    };
  }, [selfMemberId]);

  return counts;
}

/** The conversations the member can open: channels, group messages, then archived ones. */
export default function ChatSidebar({
  channels,
  unread = {},
  selfMemberId = null,
}: {
  channels: ChannelSummary[];
  /** Unread top-level messages per conversation, as of the page load. */
  unread?: Record<string, number>;
  /** Whose messages don't count as unread; null in sudo (read-only, no counts). */
  selfMemberId?: string | null;
}) {
  const pathname = usePathname();
  const activeId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;
  const counts = useUnreadCounts(unread, activeId, selfMemberId, channels);
  // Remember the open conversation so /chat can reopen it (a year; read by chat/page.tsx).
  useEffect(() => {
    if (activeId && channels.some((c) => c.id === activeId)) {
      document.cookie = `${LAST_CHAT_COOKIE}=${activeId}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [activeId, channels]);
  const [filter, setFilter] = useState("");
  // Finding a conversation by name is separate from searching what was said in them (the form
  // below, which goes to /chat/search): this only narrows the list, as you type, and sends nowhere.
  const wanted = filter.trim().replace(/^#/, "").toLowerCase();
  const shown = wanted ? channels.filter((c) => c.label.replace(/^#/, "").toLowerCase().includes(wanted)) : channels;
  // The list is the conversations the member is in; the public channels they could join sit behind
  // "Browse channels", so a long workspace doesn't bury their own.
  const [browsing, setBrowsing] = useState(false);
  const mine = shown.filter((c) => c.joined);
  const live = mine.filter((c) => !c.archived);
  const joinable = shown.filter((c) => !c.joined && c.kind === "channel" && c.visibility === "public");
  return (
    // Its own full-height column that scrolls by itself, so a long channel list never sets the
    // height of the conversation beside it. On a narrow screen it is the home screen at /chat and
    // gives way to whatever is open (which has a link back).
    <nav
      aria-label="Conversations"
      className={`shrink-0 overflow-y-auto border-slate-200 p-4 @split:h-full @split:w-60 @split:border-r dark:border-slate-800 ${
        pathname === "/chat" ? "flex-1 @split:flex-none" : "hidden @split:block"
      }`}
    >
      <form action="/chat/search" role="search" className="mb-4 px-1">
        <input
          type="search"
          name="q"
          aria-label="Search messages"
          placeholder="Search messages"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
        />
      </form>
      <div className="mb-3 px-1">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Find a channel"
          placeholder="Find a channel"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
        />
      </div>
      <Section title="Channels" channels={live.filter((c) => c.kind === "channel")} pathname={pathname} unread={counts} />
      <Section title="Group messages" channels={live.filter((c) => c.kind !== "channel")} pathname={pathname} unread={counts} />
      <Section title="Archived" channels={mine.filter((c) => c.archived)} pathname={pathname} unread={counts} />
      {channels.some((c) => !c.joined && c.kind === "channel" && c.visibility === "public") && (
        <div className="mb-4 px-1">
          <button
            type="button"
            data-track="chat-sidebar-browse"
            aria-expanded={browsing}
            onClick={() => setBrowsing((b) => !b)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 3h11M2 7h6M2 11h4" />
              <circle cx="10.5" cy="10" r="2.5" />
              <path d="m12.4 11.9 2 2" />
            </svg>
            {browsing ? "Hide other channels" : "Browse channels"}
          </button>
        </div>
      )}
      {browsing && <Section title="Channels you can join" channels={joinable} pathname={pathname} unread={counts} />}
      {browsing && joinable.length === 0 && wanted && <p className="px-3 text-sm text-slate-600 dark:text-slate-400">No other channels match.</p>}
      {channels.length === 0 && <p className="px-3 text-sm text-slate-600 dark:text-slate-400">No conversations yet.</p>}
      {channels.length > 0 && Boolean(wanted) && mine.length === 0 && !(browsing && joinable.length > 0) &&<p className="px-3 text-sm text-slate-600 dark:text-slate-400">No channels match.</p>}
      <p className="mt-4 px-3 text-xs">
        <Link data-track="chat-sidebar-privacy" href="/privacy" className="text-slate-600 underline hover:text-plum-700 dark:text-slate-400 dark:hover:text-plum-300">
          Who can see this?
        </Link>
      </p>
    </nav>
  );
}

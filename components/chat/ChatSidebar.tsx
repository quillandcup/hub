"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authenticateRealtime } from "@/lib/chat/live";
import { byRecency, loadUnreadCounts, type ChannelSummary } from "@/lib/chat/load";
import { LAST_CHAT_COOKIE } from "@/lib/chat/last-channel";
import { mentionsToPlainText } from "@/lib/chat/render";
import { subscribeDraftChanges } from "@/lib/chat/draft-events";
import { syncChatReadFromSlack } from "@/app/(member)/chat/actions";
import NewMessagePicker from "@/components/chat/NewMessagePicker";

/** A badge reads 99+ beyond that; the server stops counting at 100. */
const badge = (n: number) => (n > 99 ? "99+" : String(n));

/** Most conversations with unread messages prefetched in full per section, so a busy member doesn't render dozens at once. */
const MAX_UNREAD_PREFETCH = 5;

/** How long deletes in a conversation are batched before its count is re-read. */
const DELETE_RECOUNT_MS = 300;
/** How long after a message in a conversation the list lacks before the list is fetched again (a burst is one fetch). */
const NEW_CONVERSATION_REFRESH_MS = 500;

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

/**
 * The public channels a member is not in, in a panel under the icon in the Channels heading (so it opens
 * where they clicked, however long their own list is). It has its own finder; Escape, a click outside or
 * choosing a channel closes it. Archived channels are left for a future browse page.
 */
function BrowseChannels({ channels, pathname }: { channels: ChannelSummary[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  // Opening another conversation closes it too.
  useEffect(() => setOpen(false), [pathname]);
  const wanted = query.trim().replace(/^#/, "").toLowerCase();
  const matches = wanted ? channels.filter((c) => c.label.replace(/^#/, "").toLowerCase().includes(wanted)) : channels;
  return (
    <div ref={root}>
      <button
        type="button"
        data-track="chat-sidebar-browse"
        aria-label="Browse channels"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Browse channels"
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        className={`rounded p-1 text-slate-600 hover:bg-slate-200 focus-visible:opacity-100 group-hover:opacity-100 dark:text-slate-400 dark:hover:bg-slate-700 [@media(hover:none)]:opacity-100 ${
          open ? "bg-slate-200 opacity-100 dark:bg-slate-700" : "opacity-0"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 3h11M2 7h6M2 11h4" />
          <circle cx="10.5" cy="10" r="2.5" />
          <path d="m12.4 11.9 2 2" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Channels you can join"
          className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="px-1 pb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Channels you can join</p>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a channel to join"
            placeholder="Find a channel to join"
            className="mb-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <ul className="max-h-72 overflow-y-auto">
            {matches.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  data-track="chat-sidebar-channel"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="w-3.5 shrink-0 text-center">#</span>
                  <span className="truncate">{c.label.replace(/^#/, "")}</span>
                </Link>
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p className="px-2 py-1 text-sm text-slate-600 dark:text-slate-400">No channels match.</p>}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  channels,
  pathname,
  unread,
  action,
}: {
  title: string;
  channels: ChannelSummary[];
  pathname: string;
  unread: Record<string, number>;
  /** A control at the right of the heading, shown on hover or focus (always on a touch screen). */
  action?: React.ReactNode;
}) {
  if (channels.length === 0 && !action) return null;
  const prefetched = new Set(channels.filter((c) => c.id !== pathname.split("/")[2] && (unread[c.id] ?? 0) > 0).slice(0, MAX_UNREAD_PREFETCH).map((c) => c.id));
  return (
    <div className="group mb-4">
      <div className="relative mb-1 flex items-center justify-between px-3">
        <h2 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">{title}</h2>
        {action}
      </div>
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
                  <span className="ml-auto rounded-full bg-plum-600 px-1.5 text-xs font-medium text-white">
                    {badge(count)}
                    <span className="sr-only"> unread</span>
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

/** A conversation's (or one thread's) unsent text, for the sidebar's Drafts list. `body` is Slack markup. */
export interface SidebarDraft {
  channelId: string;
  threadRootId: string | null;
  body: string;
  /** Files attached to the draft. */
  fileCount?: number;
}

/** The member's unsent messages, newest first (as the server lists them), each opening where it was written. Nothing when there are none. */
function DraftsSection({ drafts, channels, pathname }: { drafts: SidebarDraft[]; channels: ChannelSummary[]; pathname: string }) {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const shown = drafts.filter((d) => byId.has(d.channelId));
  if (shown.length === 0) return null;
  return (
    <div className="mb-4">
      <h2 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Drafts</h2>
      <ul className="space-y-0.5">
        {shown.map((d) => {
          const channel = byId.get(d.channelId)!;
          const href = `/chat/${d.channelId}${d.threadRootId ? `?thread=${d.threadRootId}` : ""}`;
          const label = channel.kind === "channel" ? channel.label.replace(/^#/, "") : channel.label;
          return (
            <li key={`${d.channelId}:${d.threadRootId ?? ""}`}>
              <Link
                href={href}
                data-track="chat-sidebar-draft"
                aria-current={pathname === `/chat/${d.channelId}` && !d.threadRootId ? "page" : undefined}
                className="block rounded-lg px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span className="block truncate">
                  {label}
                  {d.threadRootId && <span className="text-slate-600 dark:text-slate-400"> · thread</span>}
                </span>
                <span className="block truncate text-xs text-slate-600 dark:text-slate-400">
                  {[mentionsToPlainText(d.body, { userNames: {}, channelNames: {} }), d.fileCount ? `${d.fileCount === 1 ? "1 file" : `${d.fileCount} files`}` : ""].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The drafts the sidebar lists. They start from what the server read for this page and follow the
 * message boxes as drafts are typed, emptied or sent (the layout doesn't re-run on client navigation),
 * newest edit first; they start over from the server's list whenever that changes, as after a refresh.
 */
function useDrafts(fromServer: SidebarDraft[]): SidebarDraft[] {
  const signature = JSON.stringify(fromServer);
  const [seen, setSeen] = useState(signature);
  const [drafts, setDrafts] = useState(fromServer);
  if (signature !== seen) {
    setSeen(signature);
    setDrafts(fromServer);
  }
  useEffect(
    () =>
      subscribeDraftChanges((change) => {
        const same = (d: SidebarDraft) => d.channelId === change.channelId && d.threadRootId === change.threadRootId;
        setDrafts((current) => {
          const rest = current.filter((d) => !same(d));
          const gone = change.body.trim() === "" && change.fileCount === 0;
          return gone ? rest : [{ channelId: change.channelId, threadRootId: change.threadRootId, body: change.body, fileCount: change.fileCount }, ...rest];
        });
      }),
    [],
  );
  return drafts;
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
  channels: ChannelSummary[],
  onMessage?: (channelId: string, at: string) => void
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
  const router = useRouter();
  const messageSeen = useRef(onMessage);
  const active = useRef(activeId);
  const joined = useRef(new Set<string>());
  const known = useRef(new Set<string>());
  useEffect(() => {
    active.current = activeId;
    messageSeen.current = onMessage;
    joined.current = new Set(channels.filter((c) => c.joined && !c.archived).map((c) => c.id));
    known.current = new Set(channels.map((c) => c.id));
  });

  useEffect(() => {
    if (!selfMemberId) return;
    const supabase = createClient();
    let cancelled = false;
    let subscription: ReturnType<typeof supabase.channel> | null = null;
    const stale = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A conversation the list doesn't have yet (a Slack DM that has just come in, a new channel): the layout
    // doesn't re-run on client navigation, so ask the server for the list again, once per conversation.
    const asked = new Set<string>();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const listNeedsRefresh = (channelId: string) => {
      if (known.current.has(channelId) || asked.has(channelId)) return;
      asked.add(channelId);
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), NEW_CONVERSATION_REFRESH_MS);
    };
    void (async () => {
      await authenticateRealtime(supabase);
      if (cancelled) return;
      subscription = supabase
        .channel("chat:unread")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
          const row = payload.new as { channel_id: string; thread_root_id: string | null; author_member_id: string | null; deleted_at: string | null; created_at?: string };
          if (row.deleted_at) return;
          listNeedsRefresh(row.channel_id);
          // A conversation with a new message moves to the top of its list, as in Slack.
          if (row.created_at) messageSeen.current?.(row.channel_id, row.created_at);
          if (row.thread_root_id || row.author_member_id === selfMemberId) return;
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
      if (refreshTimer) clearTimeout(refreshTimer);
      if (subscription) void supabase.removeChannel(subscription);
    };
  }, [selfMemberId, router]);

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
  drafts = [],
  canStartDm = false,
}: {
  /** Offer the New message picker in the Direct messages heading (the member can start direct messages; not in sudo). */
  canStartDm?: boolean;
  channels: ChannelSummary[];
  /** Unsent text per conversation or thread, as of the page load (the layout re-runs when a message is sent). */
  drafts?: SidebarDraft[];
  /** Unread top-level messages per conversation, as of the page load. */
  unread?: Record<string, number>;
  /** Whose messages don't count as unread; null in sudo (read-only, no counts). */
  selfMemberId?: string | null;
}) {
  const pathname = usePathname();
  const activeId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;
  // When each conversation last had a message as of what has arrived since the page loaded (Realtime), for ordering.
  const [bumps, setBumps] = useState<Record<string, string>>({});
  const counts = useUnreadCounts(unread, activeId, selfMemberId, channels, (id, at) => setBumps((b) => (b[id] && Date.parse(b[id]) >= Date.parse(at) ? b : { ...b, [id]: at })));
  /** Newest first, by the later of the server's time and what has arrived since (a stable sort: ties keep the server's order). */
  const recent = (list: ChannelSummary[]) => {
    const at = (c: ChannelSummary) => ({ lastMessageAt: bumps[c.id] && (!c.lastMessageAt || Date.parse(bumps[c.id]) > Date.parse(c.lastMessageAt)) ? bumps[c.id] : c.lastMessageAt });
    return [...list].sort((a, b) => byRecency(at(a), at(b)));
  };
  const liveDrafts = useDrafts(drafts);
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
  // The list is the conversations the member is in; the public channels they could join are in the
  // panel behind the icon in the Channels heading, so a long workspace doesn't bury their own.
  const mine = shown.filter((c) => c.joined && !c.archived);
  const joinable = channels.filter((c) => !c.joined && !c.archived && c.kind === "channel" && c.visibility === "public");
  return (
    // Its own full-height column that scrolls by itself, so a long channel list never sets the
    // height of the conversation beside it. On a narrow screen it is the home screen at /chat and
    // gives way to whatever is open (which has a link back). At /chat it takes the whole height
    // (basis-full): the pane beside it is flex-1 too and, though its placeholder is hidden there, would
    // otherwise get half of it, cutting the list short.
    <nav
      aria-label="Conversations"
      className={`shrink-0 overflow-y-auto border-slate-200 p-4 @split:h-full @split:w-60 @split:border-r dark:border-slate-800 ${
        pathname === "/chat" ? "grow basis-full @split:flex-none" : "hidden @split:block"
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
      <DraftsSection drafts={liveDrafts} channels={channels} pathname={pathname} />
      <Section
        title="Channels"
        channels={mine.filter((c) => c.kind === "channel")}
        pathname={pathname}
        unread={counts}
        action={joinable.length > 0 && <BrowseChannels channels={joinable} pathname={pathname} />}
      />
      <Section title="Group messages" channels={recent(mine.filter((c) => c.kind === "group_dm"))} pathname={pathname} unread={counts} />
      <Section
        title="Direct messages"
        channels={recent(mine.filter((c) => c.kind === "dm"))}
        pathname={pathname}
        unread={counts}
        action={canStartDm && <NewMessagePicker pathname={pathname} />}
      />
      {channels.length === 0 && <p className="px-3 text-sm text-slate-600 dark:text-slate-400">No conversations yet.</p>}
      {channels.length > 0 && Boolean(wanted) && mine.length === 0 && <p className="px-3 text-sm text-slate-600 dark:text-slate-400">No channels match.</p>}
      <p className="mt-4 px-3 text-xs">
        <Link data-track="chat-sidebar-privacy" href="/privacy" className="text-slate-600 underline hover:text-plum-700 dark:text-slate-400 dark:hover:text-plum-300">
          Who can see this?
        </Link>
      </p>
    </nav>
  );
}

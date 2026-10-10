"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authenticateRealtime } from "@/lib/chat/live";
import type { ChannelSummary } from "@/lib/chat/load";

/** A badge reads 99+ beyond that; the server stops counting at 100. */
const badge = (n: number) => (n > 99 ? "99+" : String(n));

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
  return (
    <div className="mb-4">
      <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-3">{title}</h2>
      <ul className="space-y-0.5">
        {channels.map((c) => {
          const active = pathname === `/chat/${c.id}`;
          const count = active ? 0 : (unread[c.id] ?? 0);
          return (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
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
                <span className="truncate">{c.label}</span>
                {c.visibility === "private" && c.kind === "channel" && <span title="Private channel">🔒</span>}
                {count > 0 && (
                  <span aria-hidden="true" className="ml-auto rounded-full bg-plum-600 px-1.5 text-xs font-medium text-white">
                    {badge(count)}
                  </span>
                )}
              </Link>
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
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (subscription) void supabase.removeChannel(subscription);
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
  const [filter, setFilter] = useState("");
  // Finding a conversation by name is separate from searching what was said in them (the form
  // below, which goes to /chat/search): this only narrows the list, as you type, and sends nowhere.
  const wanted = filter.trim().replace(/^#/, "").toLowerCase();
  const shown = wanted ? channels.filter((c) => c.label.replace(/^#/, "").toLowerCase().includes(wanted)) : channels;
  const live = shown.filter((c) => !c.archived);
  return (
    // Its own full-height column that scrolls by itself, so a long channel list never sets the
    // height of the conversation beside it. On a narrow screen it is the home screen at /chat and
    // gives way to whatever is open (which has a link back).
    <nav
      aria-label="Conversations"
      className={`shrink-0 overflow-y-auto border-slate-200 p-4 md:h-full md:w-60 md:border-r dark:border-slate-800 ${
        pathname === "/chat" ? "max-md:flex-1" : "max-md:hidden"
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
      <Section title="Archived" channels={shown.filter((c) => c.archived)} pathname={pathname} unread={counts} />
      {channels.length === 0 && <p className="px-3 text-sm text-slate-500">No conversations yet.</p>}
      {channels.length > 0 && shown.length === 0 && <p className="px-3 text-sm text-slate-500">No channels match.</p>}
    </nav>
  );
}

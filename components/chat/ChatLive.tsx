"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Bursts of changes (a message plus its reactions) become one refresh. */
const REFRESH_DELAY_MS = 300;
/** Within this many pixels of the bottom counts as "following the conversation". */
const NEAR_BOTTOM_PX = 150;

type Change = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };

/** The element that scrolls the page: the layout's own scroller if there is one, else the document. */
function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function scrollToBottom(anchor: HTMLElement | null) {
  const el = scrollParent(anchor);
  el.scrollTo({ top: el.scrollHeight });
}

/**
 * What the page is showing, which decides what a new message means:
 * - `latest`: the newest top-level messages (new top-level messages belong at the bottom)
 * - `thread`: one thread (new replies to `threadRootId` belong at the bottom)
 * - `older`: a `?before=` page (new messages are not on it; only edits and reactions matter)
 */
export type ChatLiveView = "latest" | "thread" | "older";

/**
 * Keeps the open conversation current: listens for changes to its messages and to reactions on
 * the messages shown over Supabase Realtime, then re-renders the server page. Realtime applies
 * the member's RLS, so only rows they can read arrive, and the events are only a signal: the
 * page re-reads through its normal access-checked loaders. (Message content is written in the
 * same transaction as its message, so it needs no subscription of its own.)
 *
 * A new message never moves someone who is reading history: when they are scrolled up it waits
 * behind a "New messages" pill; when they are at the bottom the page refreshes and follows it.
 * Anything missed while the socket was down or the tab was hidden is caught on reconnect and
 * when the tab becomes visible again.
 */
export default function ChatLive({
  channelId,
  view,
  messageIds,
  latestId,
  threadRootId,
}: {
  channelId: string;
  view: ChatLiveView;
  messageIds: string[];
  latestId: string | null;
  threadRootId?: string;
}) {
  const router = useRouter();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followNewest = useRef(false);
  const shownIds = useRef(new Set(messageIds));
  const latest = useRef(latestId);
  // The newest message on the page when the pill was raised (null = no pill). It hides itself
  // once a refresh brings in something newer, with no effect needed to reset it.
  const [announcedAt, setAnnouncedAt] = useState<{ latestId: string | null } | null>(null);
  const hasNew = announcedAt !== null && announcedAt.latestId === latestId;

  // Read through refs inside the subscription so a refresh doesn't tear it down and rebuild it.
  useEffect(() => {
    shownIds.current = new Set(messageIds);
    latest.current = latestId;
  });

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    const nearBottom = () => {
      const el = scrollParent(anchor.current);
      return el.scrollHeight - el.clientHeight - el.scrollTop <= NEAR_BOTTOM_PX;
    };

    const onMessage = (change: Change) => {
      const root = (change.new.thread_root_id ?? null) as string | null;
      const belongsAtBottom =
        change.eventType === "INSERT" &&
        ((view === "latest" && root === null) || (view === "thread" && root === threadRootId));
      if (!belongsAtBottom) return refresh();
      if (nearBottom()) {
        followNewest.current = true;
        refresh();
      } else {
        setAnnouncedAt({ latestId: latest.current });
      }
    };
    const onReaction = (change: Change) => {
      const messageId = (change.new.message_id ?? change.old.message_id) as string | undefined;
      if (messageId && shownIds.current.has(messageId)) refresh();
    };

    let subscribedBefore = false;
    let cancelled = false;
    // After a reconnect, ask what the newest message really is instead of assuming there is one:
    // the pill must only ever announce something that exists. Edits and reactions missed while
    // offline are picked up by the refresh either way.
    const catchUp = async () => {
      if (view !== "older") {
        let query = supabase.from("chat_messages").select("id").eq("channel_id", channelId).order("created_at", { ascending: false }).limit(1);
        query = view === "thread" ? query.eq("thread_root_id", threadRootId ?? "") : query.is("thread_root_id", null);
        const { data } = await query;
        const newest = data?.[0]?.id;
        if (cancelled) return;
        if (newest && newest !== latest.current) {
          if (nearBottom()) followNewest.current = true;
          else setAnnouncedAt({ latestId: latest.current });
        }
      }
      refresh();
    };
    let subscription: ReturnType<typeof supabase.channel> | null = null;
    // Realtime joins with the anon key unless it is handed the member's token first, and as
    // anon it rejects the filter and delivers nothing (the page just never updates). So load
    // the session and set its token before subscribing; later refreshes are passed on by the client.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      subscription = supabase
        .channel(`chat:${channelId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${channelId}` }, (p) => onMessage(p as unknown as Change))
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, (p) => onReaction(p as unknown as Change))
        .subscribe((status, err) => {
          if (status !== "SUBSCRIBED") {
            if (status !== "CLOSED") console.warn("[chat] live updates:", status, err?.message ?? "");
            return;
          }
          // A re-subscribe means we may have missed changes while disconnected.
          if (subscribedBefore) void catchUp();
          subscribedBefore = true;
        });
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      cancelled = true;
      if (subscription) void supabase.removeChannel(subscription);
    };
  }, [channelId, view, threadRootId, refresh]);

  // Opening a conversation lands on its newest message, as in any chat, so the first new
  // message after that is followed instead of waiting behind the pill.
  useEffect(() => {
    if (view === "latest") scrollToBottom(anchor.current);
  }, [channelId, view]);

  // Once the refreshed page has a newer last message, follow it if that is what we were doing.
  useEffect(() => {
    if (!followNewest.current) return;
    followNewest.current = false;
    scrollToBottom(anchor.current);
  }, [latestId]);

  return (
    <>
      <span ref={anchor} hidden />
      {hasNew && (
        <button
          type="button"
          onClick={() => {
            followNewest.current = true;
            setAnnouncedAt(null);
            router.refresh();
          }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-full bg-plum-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-plum-700"
        >
          New messages ↓
        </button>
      )}
    </>
  );
}

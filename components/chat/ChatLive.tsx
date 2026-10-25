"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authenticateRealtime } from "@/lib/chat/live";
import { scrollParent, scrollToHashMessage } from "@/lib/chat/scroll";
import { loadLatestChat, loadThreadChat, markChatRead } from "@/app/(member)/chat/actions";
import { emitListEvent, onPoke } from "@/lib/chat/list-events";

/** Changes right behind the first one in a burst (a message plus its reactions) fold into one more fetch. */
const REFRESH_DELAY_MS = 300;
/** Within this many pixels of the bottom counts as "following the conversation". */
const NEAR_BOTTOM_PX = 150;
/**
 * A page rendered longer ago than this when it mounts came from the router's client cache (revisited
 * within `staleTimes`), so it is brought up to date at once. Generous enough that clock skew between
 * server and browser does not trigger it on a fresh render.
 */
const CACHED_PAGE_MS = 5000;
/** Most messages with a changed reaction one fetch asks about. */
const MAX_CHANGED_IDS = 50;

type Change = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };

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
 * the messages shown over Supabase Realtime, then re-reads. Realtime applies the member's RLS, so
 * only rows they can read arrive, and the events are only a signal: what is shown is re-read
 * through the normal access-checked loaders. (Message content is written in the same transaction
 * as its message, so it needs no subscription of its own.)
 *
 * The newest-messages view and an open thread re-read just their messages (`loadLatestChat`,
 * `loadThreadChat`, handed to the list as a merge) instead of re-rendering the whole page and
 * layout, which took several seconds; older pages still refresh the page, as does any failure of
 * the small fetch.
 *
 * A new message never moves someone who is reading history: when they are scrolled up it waits
 * behind a "New messages" pill; when they are at the bottom the page refreshes and follows it.
 * Anything missed while the socket was down or the tab was hidden is caught on reconnect and
 * when the tab becomes visible again.
 */
export default function ChatLive({
  channelId,
  view,
  latestId,
  threadRootId,
  markRead = false,
  latestAt = null,
  renderedAt = null,
}: {
  channelId: string;
  view: ChatLiveView;
  latestId: string | null;
  threadRootId?: string;
  /** Mark the conversation read, through `latestAt`, when the reader leaves it (not in sudo, not in thread panels). */
  markRead?: boolean;
  /** When the newest message on the page was sent: how far the reader has seen. */
  latestAt?: string | null;
  /** When the server rendered this page (ISO). Older than a moment on mount means it was served from the client cache. */
  renderedAt?: string | null;
}) {
  const router = useRouter();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followNewest = useRef(false);
  // Messages that got a reaction since the last fetch: the newest-messages fetch brings them up to
  // date too, wherever they are in the list (a day-old message isn't among the newest).
  const changedIds = useRef(new Set<string>());
  // The newest message shown: the page's, until a small fetch finds a newer one.
  const [newest, setNewest] = useState({ fromPage: latestId, id: latestId });
  if (newest.fromPage !== latestId) setNewest({ fromPage: latestId, id: latestId });
  const currentLatestId = newest.id;
  const latest = useRef(currentLatestId);
  // The newest message when the pill was raised (null = no pill). It hides itself once a refresh
  // brings in something newer, with no effect needed to reset it.
  const [announcedAt, setAnnouncedAt] = useState<{ latestId: string | null } | null>(null);
  const hasNew = announcedAt !== null && announcedAt.latestId === currentLatestId;

  // Read through refs inside the subscription so a refresh doesn't tear it down and rebuild it.
  useEffect(() => {
    latest.current = currentLatestId;
  });

  // How far the reader has seen (for marking the conversation read when they leave).
  const leaveAt = useRef(latestAt);
  useEffect(() => {
    leaveAt.current = latestAt;
  }, [latestAt]);

  // Bring the conversation up to date: just the newest messages (or the open thread), merged into
  // the list in place; or the whole page for older pages and when that small fetch can't be done.
  const reload = useCallback(async () => {
    if (view === "older") return router.refresh();
    const changed = [...changedIds.current].slice(0, MAX_CHANGED_IDS);
    changedIds.current.clear();
    const result =
      view === "thread"
        ? await loadThreadChat(channelId, threadRootId ?? "").catch(() => null)
        : await loadLatestChat(channelId, changed).catch(() => null);
    if (!result) return router.refresh();
    if (view === "thread") {
      emitListEvent({ kind: "merge-thread", channelId, threadRootId: threadRootId ?? "", views: result.views, ctx: result.ctx });
    } else {
      emitListEvent({ kind: "merge", channelId, views: result.views, ctx: result.ctx });
    }
    // The newest message is the newest by time, not the last one in the list: a fetch can carry older
    // messages that changed.
    const last = result.views.reduce<(typeof result.views)[number] | undefined>(
      (newest, v) => (!newest || Date.parse(v.createdAt) >= Date.parse(newest.createdAt) ? v : newest),
      undefined,
    );
    if (last) {
      setNewest((prev) => ({ ...prev, id: last.id }));
      // Only what the reader is looking at counts as seen; a message behind the pill stays unread.
      const el = scrollParent(anchor.current);
      if (el.scrollHeight - el.clientHeight - el.scrollTop <= NEAR_BOTTOM_PX) leaveAt.current = last.createdAt;
    }
  }, [view, channelId, threadRootId, router]);

  // The first change of a burst is fetched at once (waiting to see whether more follow just delayed
  // every single change); changes right behind it are folded into one more fetch when the burst settles.
  const settled = useRef(false);
  const refresh = useCallback(() => {
    if (timer.current) {
      settled.current = true;
      return;
    }
    void reload();
    const cooldown = () => {
      if (settled.current) {
        settled.current = false;
        void reload();
        timer.current = setTimeout(cooldown, REFRESH_DELAY_MS);
      } else {
        timer.current = null;
      }
    };
    timer.current = setTimeout(cooldown, REFRESH_DELAY_MS);
  }, [reload]);

  // A conversation opened from the client cache shows what it had when it was cached: catch up once,
  // merged in place (the realtime subscription only reports changes from now on).
  useEffect(() => {
    if (view === "older" || !renderedAt) return;
    if (Date.now() - Date.parse(renderedAt) > CACHED_PAGE_MS) void reload();
    // Only on mount: later renders of the same page must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Someone changed something here (a reaction toggled, a message sent): catch up now, without the debounce.
  useEffect(() => onPoke(channelId, () => void reload()), [channelId, reload]);

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
    // Realtime only sends this conversation's reactions (filtered on channel_id), so every one counts.
    const onReaction = (change: Change) => {
      const messageId = (change.new.message_id ?? change.old.message_id) as string | undefined;
      if (messageId) changedIds.current.add(messageId);
      refresh();
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
    void (async () => {
      await authenticateRealtime(supabase);
      if (cancelled) return;
      subscription = supabase
        .channel(`chat:${channelId}:${view}:${threadRootId ?? ""}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${channelId}` }, (p) => onMessage(p as unknown as Change))
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions", filter: `channel_id=eq.${channelId}` }, (p) => onReaction(p as unknown as Change))
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
    // Coming back to this window (from Slack, say) catches up too, even when the tab never counted as hidden.
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      settled.current = false;
      cancelled = true;
      if (subscription) void supabase.removeChannel(subscription);
    };
  }, [channelId, view, threadRootId, refresh]);

  // The conversation counts as read when the reader leaves it (switches away, hides the tab or
  // closes it), through the newest message that was on the page, so messages that arrived behind a
  // "New messages" pill stay unread. Not when it opens: the marker would move, and the line between
  // read and new would vanish on the next refresh.
  useEffect(() => {
    if (!markRead || view !== "latest") return;
    const mark = () => {
      if (leaveAt.current) void markChatRead(channelId, leaveAt.current);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") mark();
    };
    // React's development double-mount unmounts at once; that is not the reader leaving.
    let settled = false;
    const settle = setTimeout(() => {
      settled = true;
    }, 0);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", mark);
    return () => {
      clearTimeout(settle);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", mark);
      if (settled) mark();
    };
  }, [markRead, view, channelId]);

  // Opening a conversation lands where the reader left off: on the line between what they had read
  // and what is new, if there is one, else on the newest message (so the first new message after
  // that is followed instead of waiting behind the pill).
  useEffect(() => {
    if (view !== "latest") return;
    // A link to one message (#m-<id>) wins over where the reader left off.
    if (scrollToHashMessage(anchor.current)) return;
    const scroller = scrollParent(anchor.current);
    const line = scroller.querySelector("#unread-divider");
    if (line) scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
    else scrollToBottom(anchor.current);
  }, [channelId, view]);

  // Once there is a newer last message, follow it if that is what we were doing.
  useEffect(() => {
    if (!followNewest.current) return;
    followNewest.current = false;
    scrollToBottom(anchor.current);
  }, [currentLatestId]);

  return (
    <>
      <span ref={anchor} hidden />
      {hasNew && (
        <button
          type="button"
          data-track="chat-new-messages"
          onClick={() => {
            followNewest.current = true;
            setAnnouncedAt(null);
            void reload();
          }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-full bg-plum-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-plum-700"
        >
          New messages ↓
        </button>
      )}
    </>
  );
}

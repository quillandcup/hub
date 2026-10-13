"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import MessageItem from "@/components/chat/MessageItem";
import UnreadDivider from "@/components/chat/UnreadDivider";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";
import { scrollParent } from "@/lib/chat/scroll";
import { loadOlderChat } from "@/app/(member)/chat/actions";
import { subscribeListEvents } from "@/lib/chat/list-events";
import { mergeChatContext } from "@/lib/chat/merge";

const sortKey = (m: ChatMessageView) => Date.parse(m.createdAt);

/**
 * The conversation's messages, oldest first. The server renders the newest page; this keeps
 * everything the reader has been shown (merged by id, newer data winning) so that:
 * - "Load older messages" puts the next page above, without moving what is on screen, and loads
 *   it by itself as the reader scrolls to the top;
 * - when new messages push the server's window forward, the ones that fall off the top stay.
 * Start over per conversation (and per ?before= page) with a `key`.
 */
export default function MessageList({
  channelId,
  views,
  ctx,
  olderBefore,
  firstUnreadId,
  canReact = false,
  showSent = true,
}: {
  channelId: string;
  /** The server's current window, oldest first. */
  views: ChatMessageView[];
  ctx: ChatTextContext;
  /** Cursor for the page before the server's window, or null. */
  olderBefore: string | null;
  /** The first message the reader had not seen when they opened the conversation, if any. */
  firstUnreadId?: string;
  /** The viewer can react (the chat_posting preview, not in sudo). */
  canReact?: boolean;
  /** Take part in the live conversation: show messages the viewer is sending right away and the
   *  newest messages as they are fetched (the newest page, not an older one). */
  showSent?: boolean;
}) {
  const [byId, setById] = useState(() => new Map(views.map((v) => [v.id, v])));
  const [context, setContext] = useState(ctx);
  const [seen, setSeen] = useState({ views, ctx });
  // Once an older page has been loaded its cursor replaces the server's, which only describes the newest window.
  const [loadedCursor, setLoadedCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (views !== seen.views || ctx !== seen.ctx) {
    setSeen({ views, ctx });
    setById((prev) => {
      const next = new Map(prev);
      for (const v of views) next.set(v.id, v);
      return next;
    });
    setContext((prev) => mergeChatContext(prev, ctx));
  }
  const cursor = loadedCursor === undefined ? olderBefore : loadedCursor;
  const messages = [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));

  const top = useRef<HTMLDivElement>(null);

  // A message the viewer just sent appears at once (lib/chat/optimistic.ts) and the list jumps to
  // it; the saved message replaces it, and the server's own copy (same id) overwrites that.
  const [sentCount, setSentCount] = useState(0);
  useEffect(() => {
    if (!showSent) return;
    return subscribeListEvents((event) => {
      // A reply or a thread's own refresh belongs to the thread panel, not to this list.
      if (event.channelId !== channelId || event.kind === "merge-thread" || ("threadRootId" in event && event.threadRootId)) return;
      if (event.kind === "drop") {
        setById((prev) => {
          const next = new Map(prev);
          next.delete(event.tempId);
          return next;
        });
        return;
      }
      if (event.kind === "merge") {
        // The server's newest messages: its version of each wins, and the names it found are added.
        setById((prev) => {
          const next = new Map(prev);
          for (const v of event.views) next.set(v.id, v);
          return next;
        });
        setContext((prev) => mergeChatContext(prev, event.ctx));
        return;
      }
      setById((prev) => {
        const next = new Map(prev);
        if (event.kind === "swap") next.delete(event.tempId);
        // The server's version, if it has already arrived, is newer than this one.
        if (event.kind === "add" || !next.has(event.view.id)) next.set(event.view.id, event.view);
        return next;
      });
      if (event.kind === "add") setSentCount((n) => n + 1);
    });
  }, [channelId, showSent]);
  useLayoutEffect(() => {
    if (sentCount === 0) return;
    const scroller = scrollParent(top.current);
    scroller.scrollTop = scroller.scrollHeight;
  }, [sentCount]);
  // Where the scroller was before older messages were added above, to put the reader back.
  const restore = useRef<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const before = restore.current;
    if (!before) return;
    restore.current = null;
    const scroller = scrollParent(top.current);
    scroller.scrollTop = before.top + (scroller.scrollHeight - before.height);
  }, [byId]);

  const busy = useRef(false);
  const loadOlder = async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    const result = await loadOlderChat(channelId, cursor).catch(() => null);
    busy.current = false;
    setLoading(false);
    if (!result) return setFailed(true);
    const scroller = scrollParent(top.current);
    restore.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
    setById((prev) => {
      const next = new Map(prev);
      for (const v of result.views) if (!next.has(v.id)) next.set(v.id, v);
      return next;
    });
    setContext((prev) => mergeChatContext(result.ctx, prev));
    setLoadedCursor(result.olderBefore);
  };

  // Scrolling up to the top loads the next page. (Skipped where there is no IntersectionObserver.)
  const loadRef = useRef(loadOlder);
  useEffect(() => {
    loadRef.current = loadOlder;
  });
  useEffect(() => {
    const el = top.current;
    if (!el || !cursor || failed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadRef.current();
      },
      { root: scrollParent(el), rootMargin: "200px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, failed, byId]);

  return (
    <>
      <div ref={top}>
        {cursor && (
          <button
            type="button"
            onClick={() => void loadOlder()}
            data-track="chat-load-older"
            disabled={loading}
            className="inline-block mb-2 text-sm text-plum-600 dark:text-plum-400 hover:underline disabled:opacity-60"
          >
            {loading ? "Loading older messages…" : failed ? "Couldn't load older messages. Try again" : "Load older messages"}
          </button>
        )}
      </div>
      {messages.length === 0 && <p className="py-3 text-sm text-slate-500">No messages here yet.</p>}
      {messages.map((m) => (
        <Fragment key={m.id}>
          {m.id === firstUnreadId && <UnreadDivider />}
          <MessageItem message={m} ctx={context} channelId={channelId} canReact={canReact} canEdit={canReact} />
        </Fragment>
      ))}
    </>
  );
}

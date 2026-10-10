"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import MessageItem from "@/components/chat/MessageItem";
import UnreadDivider from "@/components/chat/UnreadDivider";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";
import { scrollParent } from "@/lib/chat/scroll";
import { loadOlderChat } from "@/app/(member)/chat/actions";

const sortKey = (m: ChatMessageView) => Date.parse(m.createdAt);

function mergeCtx(a: ChatTextContext, b: ChatTextContext): ChatTextContext {
  return {
    userNames: { ...a.userNames, ...b.userNames },
    userMembers: { ...a.userMembers, ...b.userMembers },
    channelIds: { ...a.channelIds, ...b.channelIds },
    channelNames: { ...a.channelNames, ...b.channelNames },
    customEmoji: { ...a.customEmoji, ...b.customEmoji },
  };
}

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
    setContext((prev) => mergeCtx(prev, ctx));
  }
  const cursor = loadedCursor === undefined ? olderBefore : loadedCursor;
  const messages = [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));

  const top = useRef<HTMLDivElement>(null);
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
    setContext((prev) => mergeCtx(result.ctx, prev));
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
          <MessageItem message={m} ctx={context} channelId={channelId} canReact={canReact} />
        </Fragment>
      ))}
    </>
  );
}

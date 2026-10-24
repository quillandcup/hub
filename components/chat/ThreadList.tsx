"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import MessageItem from "@/components/chat/MessageItem";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";
import { subscribeListEvents } from "@/lib/chat/list-events";
import { mergeChatContext } from "@/lib/chat/merge";
import { scrollParent } from "@/lib/chat/scroll";

const sortKey = (m: ChatMessageView) => Date.parse(m.createdAt);

/**
 * An open thread: its root message and the replies under it. The server renders the first view; after
 * that this keeps it current the way `MessageList` does for the conversation, without a page
 * refresh: a reply the member just sent appears at once (and is swapped for the saved one), and
 * what `ChatLive` fetches for the thread is merged in by id, the server's version winning. Start
 * over per thread with a `key`.
 */
export default function ThreadList({
  channelId,
  threadRootId,
  root,
  replies,
  ctx,
  canReact,
  timeZone,
}: {
  channelId: string;
  threadRootId: string;
  root: ChatMessageView;
  /** The server's replies, oldest first. */
  replies: ChatMessageView[];
  ctx: ChatTextContext;
  canReact: boolean;
  timeZone?: string;
}) {
  const [rootView, setRootView] = useState(root);
  const [byId, setById] = useState(() => new Map(replies.map((v) => [v.id, v])));
  const [context, setContext] = useState(ctx);
  const [seen, setSeen] = useState({ root, replies, ctx });

  // A fresh render from the server (a page refresh) brings in its version of everything.
  if (root !== seen.root || replies !== seen.replies || ctx !== seen.ctx) {
    setSeen({ root, replies, ctx });
    setRootView(root);
    setById((prev) => {
      const next = new Map(prev);
      for (const v of replies) next.set(v.id, v);
      return next;
    });
    setContext((prev) => mergeChatContext(prev, ctx));
  }

  const end = useRef<HTMLDivElement>(null);
  const [sentCount, setSentCount] = useState(0);
  useEffect(() => {
    return subscribeListEvents((event) => {
      if (event.channelId !== channelId || event.kind === "merge") return;
      // Only this thread's: a send in the conversation itself has no thread id and isn't ours.
      if (event.threadRootId !== threadRootId) return;
      if (event.kind === "merge-thread") {
        if (event.views[0]?.id === threadRootId) setRootView(event.views[0]);
        setById((prev) => {
          const next = new Map(prev);
          for (const v of event.views.slice(1)) next.set(v.id, v);
          return next;
        });
        setContext((prev) => mergeChatContext(prev, event.ctx));
        return;
      }
      if (event.kind === "drop") {
        setById((prev) => {
          const next = new Map(prev);
          next.delete(event.tempId);
          return next;
        });
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
  }, [channelId, threadRootId]);
  useLayoutEffect(() => {
    if (sentCount === 0) return;
    const scroller = scrollParent(end.current);
    scroller.scrollTop = scroller.scrollHeight;
  }, [sentCount]);

  const replyViews = [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
  return (
    <>
      <MessageItem message={rootView} ctx={context} channelId={channelId} inThread canReact={canReact} canEdit={canReact} timeZone={timeZone} />
      <div className="ml-4 pl-4 border-l-2 border-slate-200 dark:border-slate-700">
        {replyViews.length === 0 && <p className="py-3 text-sm text-slate-600 dark:text-slate-400">No replies yet.</p>}
        {replyViews.map((m) => (
          <MessageItem key={m.id} message={m} ctx={context} channelId={channelId} inThread canReact={canReact} canEdit={canReact} timeZone={timeZone} />
        ))}
        <div ref={end} />
      </div>
    </>
  );
}

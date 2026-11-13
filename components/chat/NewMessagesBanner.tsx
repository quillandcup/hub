"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";
import { scrollParent } from "@/lib/chat/scroll";

/**
 * Slack's "N new messages" pill: shown while the "New" line (`#unread-divider`) is above the visible part of
 * the message pane, so a reader with more unread than fits on screen knows where it starts. Clicking it scrolls
 * up to the line; the X dismisses it for this visit. It goes away by itself once the line is in view.
 * The count is fixed when the banner first renders for a marker (like the line); mount it with `key={unreadId}`.
 * Sits just under the sticky day label (which is about 42px tall).
 */
export default function NewMessagesBanner({ count }: { count: number }) {
  const [fixedCount] = useState(count);
  const [above, setAbove] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const line = document.getElementById("unread-divider");
    if (!line || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        const rootTop = e.rootBounds?.top ?? 0;
        setAbove(!e.isIntersecting && e.boundingClientRect.top < rootTop);
      },
      { root: scrollParent(line) }
    );
    observer.observe(line);
    return () => observer.disconnect();
  }, []);

  if (fixedCount <= 0 || dismissed || !above) return null;

  const jump = () => {
    const line = document.getElementById("unread-divider");
    if (!line) return;
    const scroller = scrollParent(line);
    const top = scroller.scrollTop + line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 56;
    if (scroller.scrollTo) scroller.scrollTo({ top, behavior: "smooth" });
    else scroller.scrollTop = top;
    track("chat_new_messages_banner", { action: "jumped", count: fixedCount });
  };

  return (
    <div className="pointer-events-none sticky top-12 z-20 flex h-0 justify-center overflow-visible">
      <div className="pointer-events-auto flex h-8 items-center rounded-full bg-plum-600 text-xs font-medium text-white shadow-md">
        <button type="button" onClick={jump} className="flex items-center gap-1 rounded-l-full py-1 pl-3 pr-2 hover:bg-plum-700">
          <span aria-hidden="true">↑</span>
          {fixedCount} new {fixedCount === 1 ? "message" : "messages"}
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          data-track-ignore
          onClick={() => {
            setDismissed(true);
            track("chat_new_messages_banner", { action: "dismissed", count: fixedCount });
          }}
          className="rounded-r-full py-1 pl-1 pr-3 hover:bg-plum-700"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
  );
}

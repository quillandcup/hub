"use client";

import { useEffect, useRef, useState, type AnchorHTMLAttributes } from "react";
import { scrollParent } from "@/lib/chat/scroll";

/**
 * A picture of a chat card. It never shows anything but the real picture:
 * - while it loads, `reserve` keeps a quiet placeholder of a fixed height, so the card does not appear empty and then jump;
 * - when it has loaded it fades in, and if the reader was at the bottom of the conversation it stays there as the card grows;
 * - when it fails (the host is down, the route refused it) nothing is drawn, not even the link around it.
 */

/** The height kept for a picture whose size is not known yet (`h-40`); the picture itself is at most `max-h-72`. */
const RESERVED_PX = 160;
/** Within this many pixels of the end of the conversation counts as being at the bottom. */
const NEAR_BOTTOM_PX = 120;

/** Not a hover box: the picture fills the placeholder while it loads (it is the placeholder's own child, which is `relative`). */
const FILL = "absolute inset-0 h-full w-full";
const FADE = "transition-opacity duration-200 motion-reduce:transition-none";

type State = "loading" | "loaded" | "failed";

interface Props {
  src: string;
  alt: string;
  className: string;
  /** Hold space for the picture while it loads (a large picture; a thumbnail or icon already has its size). */
  reserve?: boolean;
  /** Wraps the picture in a link that goes away with it. */
  link?: { href: string; props?: AnchorHTMLAttributes<HTMLAnchorElement> };
}

export default function UnfurlPicture({ src, alt, className, reserve = false, link }: Props) {
  const [state, setState] = useState<State>("loading");
  const img = useRef<HTMLImageElement>(null);

  // The picture may have finished (or failed) before the page was interactive, so no event is coming.
  useEffect(() => {
    const el = img.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "loaded" : "failed");
  }, []);

  const loaded = () => {
    setState("loaded");
    const el = img.current;
    if (!el) return;
    // The picture is in the flow, so the page has already grown by the time this runs; if the reader was at the bottom before that, keep them there.
    const grew = Math.max(0, el.offsetHeight - (reserve ? RESERVED_PX : 0));
    const scroller = scrollParent(el);
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (grew > 0 && distance - grew <= NEAR_BOTTOM_PX) scroller.scrollTop = scroller.scrollHeight;
  };

  if (state === "failed") return null;

  const holding = reserve && state === "loading";
  const picture = (
    // Pictures are on other people's servers: no referrer, and the page doesn't wait for them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={img}
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={loaded}
      onError={() => setState("failed")}
      className={`${holding ? FILL : className} ${FADE} ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
    />
  );
  // The same element in both states (so the picture is never fetched twice); only the frame around it changes.
  const body = reserve ? (
    <span
      data-testid={holding ? "unfurl-picture-placeholder" : undefined}
      className={holding ? "relative block h-40 w-full max-w-sm animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" : "block"}
    >
      {picture}
    </span>
  ) : (
    picture
  );
  return link ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" data-track="chat-link-preview" className="mt-1 block" {...link.props}>
      {body}
    </a>
  ) : (
    body
  );
}

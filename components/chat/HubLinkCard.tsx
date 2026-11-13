"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import CardClickArea from "@/components/chat/CardClickArea";
import RemoveUnfurlButton from "@/components/chat/RemoveUnfurlButton";
import { track } from "@/lib/analytics/client";
import { formatChatTime } from "@/lib/chat/format";
import type { HubCard } from "@/lib/chat/hub-link-card";
import { hubLinkPath } from "@/lib/chat/hub-links";
import type { HubLinkUnfurl } from "@/lib/chat/unfurls";

/**
 * A link to a page of the Hub, drawn as a card (docs/SLACK_BRIDGED_CHAT.md, "Hub links"). What it shows is asked of the server for this reader
 * (GET /api/chat/hub-links, which applies the page's own access rule), never carried in the message, so a reader who may not see the target gets a
 * plain "Link to the Hub". While it asks, the card holds its place; if the answer can't be had the card is simply not drawn (the link is still in
 * the message's text). The whole card opens the page (a stretched link), and the author of the message has the X that removes it.
 */

/** What a reader was told a moment ago, so a conversation that redraws (a reaction, a live update) does not blink every card. */
const KEEP_MS = 60_000;
const answers = new Map<string, { at: number; card: HubCard }>();

/** For tests: forget what was kept. */
export function forgetHubCards() {
  answers.clear();
}

const CARD = "group relative rounded-r border-l-4 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 py-2 pl-3 pr-3 hover:bg-slate-100 dark:hover:bg-slate-800/70";
const MUTED = "text-xs text-slate-600 dark:text-slate-400";
const TITLE = "break-words text-sm font-semibold text-slate-900 dark:text-slate-100";
/** The one link of the card, its ::after stretched over the whole box. */
const LINK = "text-plum-600 underline dark:text-plum-400 after:absolute after:inset-0 after:rounded-r after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-plum-600 dark:focus-visible:after:ring-plum-400";

/** The room a card keeps while it loads, by what it will be (a quoted message is taller than a title and a date). */
const RESERVE: Record<HubLinkUnfurl["link"]["kind"], string> = { message: "h-24", prickle: "h-16", member: "h-16" };

type State = { status: "loading" } | { status: "ready"; card: HubCard } | { status: "none" };

function initial(url: string): State {
  const kept = answers.get(url);
  return kept && Date.now() - kept.at < KEEP_MS ? { status: "ready", card: kept.card } : { status: "loading" };
}

export default function HubLinkCard({
  unfurl,
  timeZone,
  removable,
}: {
  unfurl: HubLinkUnfurl;
  /** The viewer's zone, the one the message rows use, so the card and the row beside it agree. */
  timeZone?: string;
  /** Set only for the author of the message (and not in sudo): the X that removes the card. */
  removable?: { channelId: string; messageId: string };
}) {
  const { url, link } = unfurl;
  const [state, setState] = useState<State>(() => initial(url));

  useEffect(() => {
    if (state.status !== "loading") return;
    const abort = new AbortController();
    fetch(`/api/chat/hub-links?url=${encodeURIComponent(url)}`, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) return setState({ status: "none" });
        const card = (await res.json()) as HubCard;
        answers.set(url, { at: Date.now(), card });
        setState({ status: "ready", card });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: "none" });
      });
    return () => abort.abort();
  }, [url, state.status]);

  const shownState = state.status === "ready" ? state.card.state : null;
  useEffect(() => {
    if (shownState) track("chat_hub_link_card_shown", { kind: link.kind, state: shownState === "stub" ? "stub" : "card" });
  }, [shownState, link.kind]);

  if (state.status === "none") return null;
  if (state.status === "loading") {
    return <div className={`mt-1.5 max-w-xl animate-pulse rounded-r border-l-4 border-slate-300 bg-slate-100 motion-reduce:animate-none dark:border-slate-600 dark:bg-slate-800 ${RESERVE[link.kind]}`} data-testid="hub-link-card-loading" aria-hidden="true" />;
  }

  const card = state.card;
  const remove = removable && unfurl.removeKey ? <RemoveUnfurlButton channelId={removable.channelId} messageId={removable.messageId} removeKey={unfurl.removeKey} source="hub" /> : null;
  const shell = (label: string, body: ReactNode) => (
    <Shell href={hubLinkPath(link)} label={label} remove={remove}>
      {body}
    </Shell>
  );

  switch (card.state) {
    case "message":
      return shell(
        "Open in Hub Chat",
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MemberAvatar name={card.authorName} photoUrl={card.authorPhotoUrl} size={20} />
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{card.authorName}</span>
            <time dateTime={card.postedAt} className={`shrink-0 ${MUTED}`}>
              {formatChatTime(card.postedAt, timeZone)}
            </time>
          </div>
          {card.channelName && <p className={MUTED}>Posted in #{card.channelName}</p>}
          {card.text && <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-100">{card.text}</p>}
        </div>,
      );
    case "prickle":
      return shell(
        "Open the prickle",
        <div className="space-y-0.5">
          <p className={TITLE}>{card.title}</p>
          <time dateTime={card.startTime} className={MUTED}>
            {formatChatTime(card.startTime, timeZone)}
          </time>
        </div>,
      );
    case "member":
      return shell(
        "View profile",
        <div className="flex items-center gap-2">
          <MemberAvatar name={card.name} photoUrl={card.photoUrl} size={32} />
          <div className="min-w-0">
            <p className={TITLE}>{card.name}</p>
            <p className={MUTED}>Member profile</p>
          </div>
        </div>,
      );
    case "stub":
      return shell(
        "Open the link",
        <div className="space-y-0.5">
          <p className={TITLE}>Link to the Hub</p>
          <p className={MUTED}>A page in the Hub.</p>
        </div>,
      );
  }
}

/**
 * The frame every state shares: one box that is a link to the page (the footer link's ::after is stretched over it, as on the quoted-message card), the
 * text above it so it can be selected (`CardClickArea`), and the author's X in the left gutter.
 */
function Shell({ href, label, remove, children }: { href: string; label: string; remove: ReactNode; children: ReactNode }) {
  return (
    <div className="@container mt-1.5 max-w-xl" data-testid="hub-link-card">
      <div className={CARD} data-stretched-card="">
        <CardClickArea className="relative z-10">{children}</CardClickArea>
        <div className={`mt-1 ${MUTED}`}>
          <Link href={href} data-stretched-link="" data-track="chat-hub-link-card" className={LINK}>
            {label}
          </Link>
        </div>
        {remove}
      </div>
    </div>
  );
}

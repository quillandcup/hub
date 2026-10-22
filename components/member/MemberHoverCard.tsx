"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import AskMeAboutTopics from "@/components/member/AskMeAboutTopics";
import MemberSocialLinks from "@/components/member/MemberSocialLinks";
import { getMemberHoverCard } from "@/app/actions/member-hover-card";
import { track } from "@/lib/analytics/client";
import type { MemberHoverCardData } from "@/lib/member-hover-card";

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 200;
const CARD_WIDTH = 288;
const GAP = 6;
const MARGIN = 8;

type Surface = "chat" | "streaks" | "big_sisters";
type Loaded = { card: MemberHoverCardData } | { error: string };

/** Cards already fetched this page load, so hovering the same name again is instant. Errors aren't kept. */
const cache = new Map<string, MemberHoverCardData>();

/** "March 2025" from a YYYY-MM-DD date, read as the calendar date it names. */
function monthYear(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function CommentIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 0 1-13.2 7.95L3 21l1.1-4.6A9 9 0 1 1 21 12z" />
    </svg>
  );
}

function CardBody({ card }: { card: MemberHoverCardData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <MemberAvatar name={card.name} photoUrl={card.photoUrl} size={56} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{card.name}</p>
          {card.firstJoinedAt && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Hedgie since {monthYear(card.firstJoinedAt)}</p>
          )}
        </div>
      </div>
      {card.askMeAbout.length > 0 && (
        <section aria-label="Ask me about">
          <AskMeAboutTopics topics={card.askMeAbout} />
        </section>
      )}
      <MemberSocialLinks twitterUrl={card.twitterUrl} instagramUrl={card.instagramUrl} facebookUrl={card.facebookUrl} />
      <div className="flex gap-2">
        {card.messageUrl && (
          <a
            data-track="member-hover-card-message"
            href={card.messageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            <CommentIcon />
            Message
          </a>
        )}
        <Link
          data-track="member-hover-card-profile"
          href={`/members/${card.id}`}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          View profile
        </Link>
      </div>
    </div>
  );
}

/**
 * Wraps a member's name (or avatar) so hovering or focusing it shows their profile at a glance: photo,
 * how long they have been a Hedgie, what to ask them about, links, and Message / View profile.
 * Shared by chat, the streaks page and the Big Sister cards, and for any other page that names
 * another member. The card is fetched when first opened (never with the page), and shown in a portal
 * so a scrolling or clipped parent can't cut it off. Hover-only by design: a tap on a touch screen
 * follows the wrapped link as before.
 */
export default function MemberHoverCard({
  memberId,
  surface,
  name,
  photoUrl = null,
  avatarSize,
  nameClassName = "",
  trackName,
  children,
}: {
  memberId: string;
  surface: Surface;
  /** Give a name to have the card render the member's avatar and name as one link to their profile, with the card opening from either. */
  name?: string;
  photoUrl?: string | null;
  /** Avatar diameter in px, next to the name; leave out for the name alone. */
  avatarSize?: number;
  nameClassName?: string;
  /** The profile link's `data-track` name. */
  trackName?: string;
  /** What to wrap instead, for layouts that split the avatar and name (chat's avatar column, a name above a caption). */
  children?: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const scheduleOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (open || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [open]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, []);

  // Fetch on first open; a member already seen this page load comes from the cache.
  useEffect(() => {
    if (!open || loaded) return;
    const cached = cache.get(memberId);
    if (cached) {
      setLoaded({ card: cached });
      return;
    }
    let cancelled = false;
    getMemberHoverCard(memberId)
      .then((result) => {
        if ("card" in result) cache.set(memberId, result.card);
        if (!cancelled) setLoaded(result);
      })
      .catch(() => {
        if (!cancelled) setLoaded({ error: "Couldn't load this profile." });
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, memberId]);

  // Report once per opening that has a card to show.
  const reported = useRef(false);
  useEffect(() => {
    if (!open) {
      reported.current = false;
      setLoaded((l) => (l && "error" in l ? null : l));
      return;
    }
    if (loaded && "card" in loaded && !reported.current) {
      reported.current = true;
      track("member_hover_card_opened", { surface, has_message: loaded.card.messageUrl !== null });
    }
  }, [open, loaded, surface]);

  // Place under the trigger (above when there is no room), kept inside the window. Re-run when the
  // content arrives, since that changes the card's height.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const height = cardRef.current?.offsetHeight ?? 0;
    const left = Math.max(MARGIN, Math.min(t.left, window.innerWidth - CARD_WIDTH - MARGIN));
    const below = t.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN && t.top - GAP - height > MARGIN ? t.top - GAP - height : below;
    setPos({ left, top });
  }, [open, loaded]);

  // Escape closes; so does scrolling, because the card is pinned to the window, not the content.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      clearTimers();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className="inline-flex min-w-0"
      aria-describedby={open ? id : undefined}
      onPointerEnter={(e) => e.pointerType !== "touch" && scheduleOpen()}
      onPointerLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={(e) => {
        // Focus moving into the card (its buttons) keeps it open.
        if (!cardRef.current?.contains(e.relatedTarget as Node | null)) scheduleClose();
      }}
    >
      {name !== undefined ? (
        <Link data-track={trackName} href={`/members/${memberId}`} className="flex min-w-0 items-center gap-2">
          {avatarSize !== undefined && (
            <span aria-hidden="true" className="flex-shrink-0">
              <MemberAvatar name={name} photoUrl={photoUrl} size={avatarSize} />
            </span>
          )}
          <span className={`truncate hover:underline ${nameClassName}`}>{name}</span>
        </Link>
      ) : (
        children
      )}
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={id}
            role="dialog"
            aria-label="Member profile"
            onPointerEnter={scheduleOpen}
            onPointerLeave={scheduleClose}
            onBlur={(e) => {
              if (!cardRef.current?.contains(e.relatedTarget as Node | null)) scheduleClose();
            }}
            style={{ position: "fixed", width: CARD_WIDTH, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="z-50 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {!loaded && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}
            {loaded && "error" in loaded && <p className="text-slate-500 dark:text-slate-400">{loaded.error}</p>}
            {loaded && "card" in loaded && <CardBody card={loaded.card} />}
          </div>,
          document.body
        )}
    </span>
  );
}

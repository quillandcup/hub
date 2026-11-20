"use client";

import VisibilityControl from "@/components/writing/VisibilityControl";
import { ITEM_NOUN, isWebItem, levelsFor, type ProfileItem } from "@/lib/profile-visibility";
import type { Visibility } from "@/lib/writing-visibility";

/** What the member's writer page is, as far as the visibility notes need to know. */
export interface WebPageState {
  /** The `writer_pages` flag is on for them: the globe is offered, and a page can exist. */
  available: boolean;
  /** The page is switched on. */
  on: boolean;
}

const WHO: Record<Visibility, (noun: string) => string> = {
  private: (noun) => `Only you can see your ${noun}.`,
  community: (noun) => `Other members can see your ${noun}.`,
  public: (noun) => `Anyone on the internet can see your ${noun} on your writer page once the page is on. Other members can see it too.`,
};

const CLICK: Record<Visibility, (noun: string) => string> = {
  private: () => "Click to keep it to yourself.",
  community: () => "Click to show it to other members.",
  public: (noun) => `Click to show your ${noun} to everyone on the internet, on your writer page.`,
};

/** The tooltip for a profile item's control: who sees it now, and where a click goes. */
export function describeProfileItem(item: ProfileItem, visibility: Visibility, next: Visibility): string {
  const noun = ITEM_NOUN[item];
  return `${WHO[visibility](noun)} ${CLICK[next](noun)}`;
}

/**
 * The plain note under an item whose level is the globe, so the globe never promises more than will happen: the page is
 * off, or pages on the web are not open to this member, or the page uses a separate public bio instead. Null when the
 * level needs no note.
 */
export function webNote(item: ProfileItem, visibility: Visibility, page: WebPageState, extra: { separateBio?: boolean; photoPublishable?: boolean } = {}): string | null {
  if (visibility !== "public" || !isWebItem(item)) return null;
  if (!page.available) return "Not shown on the web: pages on the web are not open to you yet.";
  if (item === "bio" && extra.separateBio) return "Your writer page uses your separate public bio instead.";
  if (item === "photo" && extra.photoPublishable === false) return "No photo can be shown on the web. A Gravatar picture is never published, because its address carries a code made from your email.";
  if (!page.on) return "Shown on the web once your writer page is on.";
  return null;
}

/**
 * The lock, house or globe on one item of the profile (docs/WRITER_PROFILES.md, "Who sees what"), with the note that says
 * what the globe does right now. One click cycles the levels the item can have; the caller saves the level. The globe is
 * offered only on items the writer page shows, and only where pages on the web are open to the member.
 */
export default function ProfileItemVisibility({
  item,
  visibility,
  page,
  onChange,
  disabled,
  separateBio,
  photoPublishable,
}: {
  item: ProfileItem;
  visibility: Visibility;
  page: WebPageState;
  onChange: (next: Visibility) => void;
  disabled?: boolean;
  /** The bio has a separate public bio, so the page does not use the member bio: no globe to offer on it. */
  separateBio?: boolean;
  photoPublishable?: boolean;
}) {
  const offered = item === "bio" && separateBio ? levelsFor(item, { webPageAvailable: false }) : levelsFor(item, { webPageAvailable: page.available });
  // A level the member already has but cannot pick any more (the globe, once pages on the web are closed to them) still shows;
  // a click moves on to the first level they can pick.
  const levels = offered;
  const note = webNote(item, visibility, page, { separateBio, photoPublishable });
  return (
    <span className="inline-flex flex-col items-end">
      <VisibilityControl
        visibility={visibility}
        onChange={onChange}
        disabled={disabled}
        noun={ITEM_NOUN[item]}
        levels={levels}
        describe={(current, next) => describeProfileItem(item, current, next)}
        withText
        className="text-xs text-slate-600 dark:text-slate-400"
      />
      {note && (
        <span data-testid={`note-${item}`} className="mt-0.5 max-w-xs text-right text-xs text-slate-600 dark:text-slate-400">
          {note}
        </span>
      )}
    </span>
  );
}

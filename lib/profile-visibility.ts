import { VISIBILITIES, type Visibility } from "@/lib/writing-visibility";

/**
 * Who can see each item on a member's profile (docs/product/WRITER_PROFILES.md, "Who sees what"). The same three levels as a
 * writing project (`lib/writing-visibility.ts`): private (only the member), community (signed-in members, what every item
 * was before this existed) and public (anyone on the internet, on the member's writer page).
 *
 * The globe is offered only on what the writer page shows today (`WEB_ITEMS`), so it never promises what does not exist.
 */
export const WEB_ITEMS = ["bio", "photo", "instagram", "facebook", "x"] as const;
export type WebItem = (typeof WEB_ITEMS)[number];

/** Every item with a level: the web items, and the "Ask me about" topics (members only, never on the web). */
export const PROFILE_ITEMS = [...WEB_ITEMS, "ask_me_about"] as const;
export type ProfileItem = (typeof PROFILE_ITEMS)[number];

export type ProfileVisibilities = Record<ProfileItem, Visibility>;

/** What an item is until the member changes it: shown to signed-in members, as it always was. */
export const DEFAULT_PROFILE_VISIBILITY: Visibility = "community";

export function defaultProfileVisibilities(): ProfileVisibilities {
  return Object.fromEntries(PROFILE_ITEMS.map((item) => [item, DEFAULT_PROFILE_VISIBILITY])) as ProfileVisibilities;
}

export function isProfileItem(value: unknown): value is ProfileItem {
  return typeof value === "string" && (PROFILE_ITEMS as readonly string[]).includes(value);
}

export function isWebItem(item: ProfileItem): item is WebItem {
  return (WEB_ITEMS as readonly string[]).includes(item);
}

/** The column of `member_profile_overrides` that holds a web item's level. */
export const VISIBILITY_COLUMN = {
  bio: "bio_visibility",
  photo: "photo_visibility",
  instagram: "instagram_visibility",
  facebook: "facebook_visibility",
  x: "twitter_visibility",
} as const satisfies Record<WebItem, string>;

/**
 * The levels one click cycles through for an item. The globe is for web items, and only where the member can have a writer
 * page (the `writer_pages` flag): otherwise it would promise something that does not exist. A level the member already has
 * stays reachable by the control (it shows it), so nothing is hidden from them.
 */
export function levelsFor(item: ProfileItem, options: { webPageAvailable: boolean }): readonly Visibility[] {
  return isWebItem(item) && options.webPageAvailable ? VISIBILITIES : VISIBILITIES.filter((level) => level !== "public");
}

/** Whether the level is one the server accepts for this item (the globe only on web items). */
export function isLevelAllowed(item: ProfileItem, level: unknown): level is Visibility {
  return typeof level === "string" && (VISIBILITIES as readonly string[]).includes(level) && (level !== "public" || isWebItem(item));
}

/**
 * Whether the writer page shows an item: the page is on, the flag is on for its owner and the item's level is the globe. The
 * one rule the page and the settings share (the page itself is built by the repository from the same facts).
 */
export function shownOnTheWeb(level: Visibility, page: { on: boolean; flagOn: boolean }): boolean {
  return page.on && page.flagOn && level === "public";
}

/** The plain name of each item, as the control and its tooltip say it ("who can see your bio"). */
export const ITEM_NOUN: Record<ProfileItem, string> = {
  bio: "bio",
  photo: "photo",
  instagram: "Instagram link",
  facebook: "Facebook link",
  x: "X link",
  ask_me_about: "list of topics",
};

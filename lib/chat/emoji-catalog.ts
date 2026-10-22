import type { CustomEmoji } from "@/lib/chat/emoji";

/**
 * What the reaction picker lists. Pure helpers (no emojibase import): the component loads the
 * dataset lazily and hands it to buildCatalog, so none of it is in the main bundle.
 */

export type CategoryId = "people" | "nature" | "food" | "travel" | "activities" | "objects" | "symbols" | "flags";

export const CATEGORIES: { id: CategoryId; label: string; icon: string }[] = [
  { id: "people", label: "Smileys & People", icon: "😀" },
  { id: "nature", label: "Nature", icon: "🌿" },
  { id: "food", label: "Food", icon: "🍔" },
  { id: "travel", label: "Travel", icon: "✈️" },
  { id: "activities", label: "Activities", icon: "⚽" },
  { id: "objects", label: "Objects", icon: "💡" },
  { id: "symbols", label: "Symbols", icon: "❤️" },
  { id: "flags", label: "Flags", icon: "🏁" },
];

/** emojibase group number -> our category (group 2 is skin-tone components: not listed). */
const GROUPS: Record<number, CategoryId> = {
  0: "people",
  1: "people",
  3: "nature",
  4: "food",
  5: "travel",
  6: "activities",
  7: "objects",
  8: "symbols",
  9: "flags",
};

export type StandardEntry = {
  /** The Slack shortcode (no colons), what the reaction API takes. */
  name: string;
  unicode: string;
  category: CategoryId;
  /** Lower-case words the search matches besides the names. */
  keywords: string;
};

type RawEmoji = { hexcode: string; emoji: string; label: string; tags?: string[]; group?: number; tone?: unknown };

/** Standard emoji that have a Slack shortcode; skin-tone variants are left out (the base emoji is listed). */
export function buildCatalog(data: RawEmoji[], shortcodes: Record<string, string | string[]>): StandardEntry[] {
  const out: StandardEntry[] = [];
  for (const e of data) {
    const category = e.group === undefined ? undefined : GROUPS[e.group];
    if (!category || e.tone !== undefined) continue;
    const names = [shortcodes[e.hexcode] ?? []].flat();
    if (names.length === 0) continue;
    out.push({
      name: names[0],
      unicode: e.emoji,
      category,
      keywords: [...names.slice(1), e.label, ...(e.tags ?? [])].join(" ").toLowerCase(),
    });
  }
  return out;
}

/** Standard emoji whose name, alias, label or tag contains the query (name matches first). */
export function searchStandard(catalog: StandardEntry[], query: string): StandardEntry[] {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!q) return [];
  const starts: StandardEntry[] = [];
  const rest: StandardEntry[] = [];
  for (const e of catalog) {
    if (e.name.startsWith(q)) starts.push(e);
    else if (e.name.includes(q) || e.keywords.includes(q)) rest.push(e);
  }
  return [...starts, ...rest];
}

/** Custom emoji names containing the query, or all of them for an empty query; aliases to unknown things are fine. */
export function customNames(custom: Record<string, CustomEmoji>, query = ""): string[] {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
  return Object.keys(custom)
    .filter((n) => n.includes(q))
    .sort();
}

const RECENTS_KEY = "chat-recent-reactions";
const MAX_RECENTS = 16;

export function readRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

/** Most recent first, no repeats. Storage failures (private mode, quota) are ignored. */
export function rememberRecent(name: string): void {
  try {
    const next = [name, ...readRecents().filter((n) => n !== name)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience.
  }
}

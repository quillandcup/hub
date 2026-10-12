import { ORG_TIMEZONE } from "@/lib/config";
import type { SearchKind } from "@/lib/search/syntax";

/** What each kind's title, subtitle, badge and date columns are called on the results page. */
export const KIND_COLUMNS: Record<SearchKind, { title: string; subtitle?: string; badge?: string; date?: string }> = {
  members: { title: "Member", subtitle: "About", badge: "Status" },
  prickles: { title: "Prickle", date: "When" },
  projects: { title: "Project", subtitle: "Member" },
  books: { title: "Book", subtitle: "Author", date: "Published" },
  awards: { title: "Award", subtitle: "Work", date: "Date" },
  events: { title: "Event", subtitle: "Where", date: "When" },
  chat: { title: "Message", subtitle: "Where", date: "Sent" },
};

/** A short badge for each kind's icon chip. */
export const KIND_GLYPHS: Record<SearchKind, string> = {
  members: "Me", prickles: "Pr", projects: "Pj", books: "Bk", awards: "Aw", events: "Ev", chat: "Ch",
};

/** A date-only value (YYYY-MM-DD) is the same day everywhere; a timestamp is shown in the org's timezone. */
export function formatHitDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: dateOnly ? "UTC" : ORG_TIMEZONE,
  });
}

export interface Segment {
  text: string;
  match: boolean;
}

/** `text` split into runs, marking where any of `words` occurs (case-insensitive, accents folded only by the database). */
export function highlightSegments(text: string, words: string[]): Segment[] {
  const needles = words.map((w) => w.trim()).filter(Boolean);
  if (needles.length === 0 || !text) return [{ text, match: false }];
  const escaped = needles.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return text
    .split(re)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, match: needles.some((w) => w.toLowerCase() === part.toLowerCase()) }));
}

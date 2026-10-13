import type { SearchKind } from "@/lib/search/syntax";

/** Types and labels shared by the search code and its client components (no server imports). */

export const KIND_LABELS: Record<SearchKind, string> = {
  pages: "Pages",
  channels: "Channels",
  members: "Members",
  prickles: "Prickles",
  projects: "Projects",
  books: "Books",
  awards: "Awards",
  events: "Events",
  chat: "Chat",
};

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** One gray line under the title. */
  subtitle?: string;
  href: string;
  /** ISO date shown at the right of the row, when the kind has one. */
  date?: string;
  imageUrl?: string | null;
  /** Small label next to the title (a status, an event type). */
  badge?: string;
  /** Shown dimmed (an archived channel): still a result, but not a current one. */
  muted?: boolean;
}

export interface KindResults {
  kind: SearchKind;
  hits: SearchHit[];
  /** More rows exist past this page. */
  hasMore: boolean;
}

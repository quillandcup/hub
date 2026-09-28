/**
 * The member directory (/members): who's currently a Hedgie and what they're working on.
 * Pure helpers shared by the page (server) and its search box (client).
 */

export interface DirectoryEntry {
  id: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  firstJoinedAt: string | null;
  /** Titles of writing projects the member opted onto their profile ("Show on my profile"). */
  projects: string[];
  /** "Ask me about ..." topics. */
  topics: string[];
  /** The viewer's own private note about this member (never another member's), or null. */
  myNote: string | null;
}

function fold(text: string): string {
  // Case- and accent-insensitive: "Zoë" matches "zoe".
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Everything a search matches against: name, bio, projects, topics, and the viewer's own note
 * (so "who did I say writes romance?" works), folded for comparison.
 */
export function directorySearchText(entry: DirectoryEntry): string {
  return fold([entry.displayName, entry.bio, ...entry.projects, ...entry.topics, entry.myNote].filter(Boolean).join("\n"));
}

/** Every whitespace-separated word of `query` must appear somewhere in the entry. Blank matches all. */
export function filterDirectory<T extends DirectoryEntry>(entries: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const text = directorySearchText(entry);
    return words.every((w) => text.includes(w));
  });
}

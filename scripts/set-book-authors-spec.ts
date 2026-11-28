// The spec and the matching for scripts/set-book-authors.ts, pure so they can be tested without a database. The spec names real
// people, so it lives outside the repo; nothing here prints a name, only positions, titles and counts.

export interface AuthorSpec {
  /** The book's title as the old Bookshelf page lists it. */
  title: string;
  /** The author name as that page lists it. */
  name: string;
  /** The member's account name or display name, only when two members have a book with this title. */
  memberName?: string;
}

export type ParsedAuthorSpec = { ok: true; entries: AuthorSpec[] } | { ok: false; errors: string[] };

const LONGEST_NAME = 80;
const MOST_WORDS = 6;
const WEB_ADDRESS = /:\/\/|\bwww\.|\b[\w-]+\.(?:com|net|org|io|co|uk|me|info|biz|app|dev|ca|au|us|xyz|ly)\b/i;

/**
 * The name as it will be stored: trimmed, inner spaces collapsed, a leading "By" dropped. A reason (never the name itself) when it is not
 * something to put on a book: empty, too short or long, an email, a web address, markup, digits or no letter, or too many words.
 */
export function normalizeAuthorName(raw: unknown): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "is not text" };
  const name = raw.replace(/\s+/g, " ").trim().replace(/^by\s+/i, "").trim();
  if (name === "") return { ok: false, reason: "is empty" };
  if (name.length < 2) return { ok: false, reason: "is too short to be a name" };
  if (name.length > LONGEST_NAME) return { ok: false, reason: `is longer than ${LONGEST_NAME} characters` };
  if (name.includes("@")) return { ok: false, reason: "looks like an email address" };
  if (WEB_ADDRESS.test(name)) return { ok: false, reason: "looks like a web address" };
  if (/[<>{}[\]\\|]/.test(name) || /\p{C}/u.test(name)) return { ok: false, reason: "has characters a name does not" };
  if (/\d/.test(name)) return { ok: false, reason: "has digits, which a name does not" };
  if (!/\p{L}/u.test(name)) return { ok: false, reason: "has no letters" };
  if (name.split(" ").length > MOST_WORDS) return { ok: false, reason: `has more than ${MOST_WORDS} words` };
  return { ok: true, name };
}

/** A title (or a member's name) as it is compared: no accents, no case, "&" as "and", punctuation and runs of spaces as one space. */
export function normalizeKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Every problem in the spec, by position, so one run lists them all. A problem never repeats the name. */
export function parseAuthorSpec(input: unknown): ParsedAuthorSpec {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errors: ["The spec must be a non-empty JSON array"] };
  const errors: string[] = [];
  const entries: AuthorSpec[] = [];
  input.forEach((raw, index) => {
    const at = `Entry ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const entry = raw as Record<string, unknown>;
    const before = errors.length;
    if (typeof entry.title !== "string" || normalizeKey(entry.title) === "") errors.push(`${at}: title is missing`);
    const name = normalizeAuthorName(entry.name);
    if (!name.ok) errors.push(`${at}: name ${name.reason}`);
    if (entry.memberName !== undefined && (typeof entry.memberName !== "string" || normalizeKey(entry.memberName) === "")) errors.push(`${at}: memberName must be text when given`);
    if (errors.length === before && name.ok) {
      entries.push({ title: (entry.title as string).trim(), name: name.name, ...(typeof entry.memberName === "string" ? { memberName: entry.memberName.trim() } : {}) });
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

export interface PlanBook {
  id: string;
  member_id: string;
  title: string;
  pen_name: string | null;
}
export interface PlanMember {
  id: string;
  name: string;
  displayName: string | null;
}

export type Outcome =
  /** Exactly one live book, with no pen name: it gets the listed name. */
  | { kind: "set"; index: number; title: string; bookId: string; name: string }
  /** Exactly one live book, and it already has a pen name (a member's choice, or an earlier run): left alone. */
  | { kind: "has_pen_name"; index: number; title: string; bookId: string }
  /** Only with `skipWithDisplayName`: the member has a display name, which the web already shows for this book, so it is left alone. */
  | { kind: "has_display_name"; index: number; title: string; bookId: string }
  /** No live book with that title (or none of that member's). */
  | { kind: "unmatched"; index: number; title: string }
  /** Several live books fit, or two entries want different names for one book. */
  | { kind: "ambiguous"; index: number; title: string; why: "several_books" | "conflicting_names" };

export interface Plan {
  outcomes: Outcome[];
  counts: {
    entries: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    alreadyHasPenName: number;
    wouldSet: number;
    /** Of those to set: books whose member has no display name, which show no author line today and would get one. */
    wouldAddAuthorLine: number;
    /** Of those to set: the member's display name is the same name, so the web shows no change. */
    sameAsDisplayName: number;
    /** Of those to set: the member has a different display name, which the web would stop showing for this book. */
    wouldReplaceDisplayName: number;
    /** Skipped because the member has a display name (`skipWithDisplayName`). */
    skippedDisplayName: number;
  };
}

export interface PlanOptions {
  /** Leave a book alone when its member has a display name (the web shows that name already). Default: set the listed name anyway. */
  skipWithDisplayName?: boolean;
}

/**
 * Which book each entry names: found by normalized title, and by member when one is given (the member's account name or display
 * name, normalized the same way). Nothing is guessed: no book, or more than one, is skipped and counted. A book an earlier
 * entry already claims with the same name counts once; with a different name, both are ambiguous.
 */
export function planAuthors(entries: AuthorSpec[], books: PlanBook[], members: PlanMember[], options: PlanOptions = {}): Plan {
  const displayNameOf = (memberId: string) => members.find((m) => m.id === memberId)?.displayName?.trim() || null;
  const byTitle = new Map<string, PlanBook[]>();
  for (const book of books) {
    const key = normalizeKey(book.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), book]);
  }

  const resolved = entries.map((entry, index) => {
    const wanted = normalizeKey(entry.title);
    let candidates = byTitle.get(wanted) ?? [];
    if (entry.memberName) {
      const who = normalizeKey(entry.memberName);
      const ids = new Set(members.filter((m) => normalizeKey(m.name) === who || (m.displayName !== null && normalizeKey(m.displayName) === who)).map((m) => m.id));
      candidates = candidates.filter((b) => ids.has(b.member_id));
    }
    return { entry, index, candidates };
  });

  const namesFor = new Map<string, Set<string>>();
  for (const { entry, candidates } of resolved) {
    if (candidates.length === 1) namesFor.set(candidates[0].id, (namesFor.get(candidates[0].id) ?? new Set<string>()).add(entry.name));
  }

  const outcomes: Outcome[] = [];
  const claimed = new Set<string>();
  for (const { entry, index, candidates } of resolved) {
    const base = { index, title: entry.title };
    if (candidates.length === 0) outcomes.push({ kind: "unmatched", ...base });
    else if (candidates.length > 1) outcomes.push({ kind: "ambiguous", ...base, why: "several_books" });
    else if ((namesFor.get(candidates[0].id)?.size ?? 0) > 1) outcomes.push({ kind: "ambiguous", ...base, why: "conflicting_names" });
    else if (candidates[0].pen_name?.trim()) outcomes.push({ kind: "has_pen_name", ...base, bookId: candidates[0].id });
    else if (claimed.has(candidates[0].id)) outcomes.push({ kind: "has_pen_name", ...base, bookId: candidates[0].id });
    else if (options.skipWithDisplayName && displayNameOf(candidates[0].member_id)) outcomes.push({ kind: "has_display_name", ...base, bookId: candidates[0].id });
    else {
      claimed.add(candidates[0].id);
      outcomes.push({ kind: "set", ...base, bookId: candidates[0].id, name: entry.name });
    }
  }

  const count = (kind: Outcome["kind"]) => outcomes.filter((o) => o.kind === kind).length;
  const alreadyHasPenName = count("has_pen_name");
  const wouldSet = count("set");
  const sets = outcomes.flatMap((o) => (o.kind === "set" ? [o] : []));
  const shownToday = (o: (typeof sets)[number]) => displayNameOf(books.find((b) => b.id === o.bookId)!.member_id);
  const sameAsDisplayName = sets.filter((o) => { const d = shownToday(o); return d !== null && normalizeKey(d) === normalizeKey(o.name); }).length;
  const wouldAddAuthorLine = sets.filter((o) => shownToday(o) === null).length;
  return {
    outcomes,
    counts: { entries: entries.length, matched: alreadyHasPenName + wouldSet + count("has_display_name"), unmatched: count("unmatched"), ambiguous: count("ambiguous"), alreadyHasPenName, wouldSet, wouldAddAuthorLine, sameAsDisplayName, wouldReplaceDisplayName: wouldSet - wouldAddAuthorLine - sameAsDisplayName, skippedDisplayName: count("has_display_name") },
  };
}

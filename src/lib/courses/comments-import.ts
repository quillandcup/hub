import sanitizeHtml from "sanitize-html";
import type { ImportableLessonComment } from "@/lib/data/kajabi-courses";
import type { ImportedCommentRecord, ImportedCommentWrite } from "@/lib/data/course-comments";
import type { Repos } from "@/lib/data/repos";
import { COMMENT_MAX_LENGTH } from "@/lib/courses/comments";
import { staffAmong } from "@/lib/courses/comment-readers";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";

type CommentsImportRepos = Pick<Repos, "courses" | "kajabiCourses" | "courseComments" | "billing" | "members" | "aliases" | "profiles">;

/** The `lesson_comments.source` of a comment that came from Kajabi. */
export const KAJABI_COMMENT_SOURCE = "kajabi";
/** How many names of unmatched and ambiguous authors a summary lists (the counts are always complete). */
const AUTHOR_LIST_LIMIT = 100;

/**
 * Bronze (bronze.kajabi_lesson_comments) -> Silver `lesson_comments` (docs/product/COURSES.md, "Lesson comments", Kajabi
 * migration). The Bronze rows are a capture of the member lesson pages, so the source is the capture, not a webhook, and
 * there is no pull-based twin: the capture is the pull (`courses:content --comments`).
 *
 * One Hub comment per Bronze comment, keyed `source = 'kajabi'`, `source_key = "<lesson id>/<comment key>"` (unique), so running
 * it again never duplicates. The import owns what Kajabi said (author, text, time, thread position, whether it was removed
 * there) and nothing else: a staff hide, a report, a handled mark or a staff delete is never undone. It:
 *  - writes each comment as the Hub member its author is (see `matchAuthors`): the capture has only the name Kajabi shows, so
 *    the name must be exactly one Kajabi contact's name (or several contacts of one member), never fuzzy. A name that matches no
 *    member, or more than one, is not guessed: its comments are skipped and listed in the summary, so nothing is silently
 *    dropped. A member who is staff is shown with the Instructor badge;
 *  - keeps Kajabi's own time as `created_at`, and threads a reply under its comment (a reply to a reply goes under the
 *    comment above it; a reply whose comment is not imported becomes a top-level comment and is counted);
 *  - creates no follow, no notification and no report, is never held, and (being old, source-marked) never counts as new or as an
 *    unanswered question;
 *  - soft deletes (`deleted_at`, no `deleted_by`) a comment Bronze has since marked removed, and restores one it lists again,
 *    unless a person deleted it in the Hub.
 */

/** An author name the match could not settle, with how many comments carry it. Names are personal data: this goes to the admin who runs the import, never to logs. */
export interface UnsettledAuthor {
  name: string;
  comments: number;
  /** For an ambiguous name, how many different members it could be. */
  members?: number;
}

export interface CourseCommentsImport {
  slug: string;
  /** Comments in Bronze for the course's lessons (removed ones included). */
  commentsInBronze: number;
  /** Comments whose Kajabi lesson has no Hub lesson (removed in Kajabi, or not synced yet): not imported. */
  unmatchedLessonComments: number;
  /** Different author names among the comments that could be imported, by how they matched. */
  authors: { matched: number; staff: number; unmatched: number; ambiguous: number };
  /** Comments skipped because their author's name matches no member, or more than one. Listed below, never guessed. */
  unmatchedAuthorComments: number;
  ambiguousAuthorComments: number;
  /** The names behind those counts, most comments first (at most 100 each). */
  unmatchedAuthors: UnsettledAuthor[];
  ambiguousAuthors: UnsettledAuthor[];
  /** Replies among the comments to import. */
  replies: number;
  /** Replies whose comment is not imported (not in Bronze, or its author unsettled): written as top-level comments. */
  orphanReplies: number;
  /** Comments with no text left after cleaning, or removed in Kajabi before the Hub ever had them: skipped. */
  skipped: number;
  /** Comments shortened to the Hub's length limit. */
  truncated: number;
  /** Rows written (or, in a dry run, that would be). */
  inserted: number;
  updated: number;
  /** Already the same in the Hub. */
  unchanged: number;
  /** Of the written rows: soft deleted because Kajabi no longer lists them, and brought back because it lists them again. */
  removed: number;
  restored: number;
}

export interface CommentsImportResult {
  dryRun: boolean;
  courses: CourseCommentsImport[];
}

export class CommentsImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Tags that end a line of text; every other tag is dropped with its attributes. */
const LINE_TAGS = ["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"];
const CLOSING_LINE_TAG = new RegExp(`</(?:${LINE_TAGS.join("|")})>`, "g");
const OPENING_LINE_TAG = new RegExp(`<(?:${LINE_TAGS.join("|")})>`, "g");

/**
 * A captured comment as the Hub stores it: plain text. The capture already reads text, but a body that carries markup
 * (older captures, a pasted snippet) is reduced here by the HTML parser the lesson text uses (`sanitize-html`, allowing only
 * the line-ending tags and no attribute, and dropping what script and style hold): line breaks and block ends become newlines,
 * every other tag goes with its attributes, and the text left is decoded once. Then line endings are normalized, runs of blank
 * lines collapsed and the ends trimmed. Text that merely contains `<` (as in "a < b") is left alone, since only tag-shaped
 * text is a tag. The result is only ever shown as text, never as HTML.
 */
export function plainCommentText(raw: string): string {
  const parsed = sanitizeHtml(raw, {
    allowedTags: ["br", ...LINE_TAGS],
    allowedAttributes: {},
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  });
  const text = parsed
    // The parser writes these tags in one fixed form, so replacing exactly that form is complete.
    .split("<br />")
    .join("\n")
    .replace(CLOSING_LINE_TAG, "\n")
    .replace(OPENING_LINE_TAG, "")
    // Text outside tags was escaped by the parser (& < > "): decode it in one pass, so a decoded & is never decoded again.
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === "#") {
        const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    });
  return text
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The key two author names are compared by: markup dropped, Unicode composed, whitespace collapsed and trimmed, lowercased.
 * Nothing fuzzier (no punctuation or accent stripping, no nicknames): a name is the same name or it is not. An empty name, or
 * one that is an email address, has no key and matches no one.
 */
export function authorNameKey(raw: string | null | undefined): string {
  const name = plainCommentText(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || /\S+@\S+\.\S+/.test(name)) return "";
  return name.toLowerCase();
}

/** The display form of an author's name for the summary: one line, markup dropped, at most 200 characters. */
function displayName(raw: string | null | undefined): string {
  const name = plainCommentText(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!name) return "(no name)";
  return /\S+@\S+\.\S+/.test(name) ? "(an email address)" : name;
}

export type AuthorMatch = { status: "matched"; memberId: string } | { status: "unmatched" } | { status: "ambiguous"; members: number };

/** What the match reads: Kajabi contacts (name and email), the members by email, and the email aliases. Loaded once per run. */
interface AuthorDirectory {
  contacts: { name: string | null; email: string }[];
  memberIdsByEmail: Map<string, string[]>;
  aliasMap: ReturnType<typeof buildAliasMap>;
}

async function loadDirectory(repos: CommentsImportRepos): Promise<AuthorDirectory> {
  const [contacts, identities, aliases] = await Promise.all([
    repos.billing.kajabiContacts(),
    repos.members.identities(),
    repos.aliases.emailAliases({ activeOnly: true }),
  ]);
  const memberIdsByEmail = new Map<string, string[]>();
  for (const m of identities) {
    const key = m.email.trim().toLowerCase();
    memberIdsByEmail.set(key, [...(memberIdsByEmail.get(key) ?? []), m.id]);
  }
  return { contacts, memberIdsByEmail, aliasMap: buildAliasMap(aliases) };
}

/**
 * Which Hub member each author name is, by the one thing the capture has: the name Kajabi showed. A name is looked up among
 * the Kajabi contacts with exactly that name (`authorNameKey`), each contact's email is resolved to a member (their own email
 * or an active alias, as the progress import does), and the name is settled only when that gives exactly one member: several
 * contacts of one person are fine, several people are `ambiguous`, none is `unmatched`. Never fuzzy, never a guess.
 */
export function matchAuthors(keys: Set<string>, directory: AuthorDirectory): Map<string, AuthorMatch> {
  const membersOfName = new Map<string, Set<string>>();
  for (const contact of directory.contacts) {
    const key = authorNameKey(contact.name);
    if (!key || !keys.has(key)) continue;
    const ids = directory.memberIdsByEmail.get(resolveEmail(contact.email, directory.aliasMap)) ?? [];
    const set = membersOfName.get(key) ?? new Set<string>();
    for (const id of ids) set.add(id);
    membersOfName.set(key, set);
  }
  const out = new Map<string, AuthorMatch>();
  for (const key of keys) {
    const members = [...(membersOfName.get(key) ?? [])];
    out.set(key, members.length === 1 ? { status: "matched", memberId: members[0] } : members.length === 0 ? { status: "unmatched" } : { status: "ambiguous", members: members.length });
  }
  return out;
}

const sourceKeyOf = (lessonKajabiId: string, commentKey: string) => `${lessonKajabiId}/${commentKey}`;

/** A Bronze comment that can be imported as far as its lesson and text go, before its author is settled. */
interface Candidate {
  sourceKey: string;
  lessonId: string;
  authorKey: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** Kajabi no longer lists it. */
  removedInKajabi: boolean;
  removedAt: string | null;
  bronze: ImportableLessonComment;
}

/** What Kajabi says about one comment, ready to compare with the Hub's row. */
interface Wanted extends Candidate {
  memberId: string;
  isStaffReply: boolean;
  /** The source key of the comment above it, or null for a top-level comment. */
  parentKey: string | null;
}

export async function importKajabiLessonComments(
  repos: CommentsImportRepos,
  options: { courseSlug?: string; dryRun?: boolean } = {},
): Promise<CommentsImportResult> {
  const dryRun = options.dryRun ?? false;
  const only = options.courseSlug ? await repos.courses.courseBySlug(options.courseSlug, { source: "kajabi" }) : null;
  const courses = options.courseSlug ? (only ? [only] : []) : await repos.courses.courses({ source: "kajabi" });
  if (options.courseSlug && courses.length === 0) throw new CommentsImportError(`No Kajabi course has the slug "${options.courseSlug}"`, 404);

  let directory: Promise<AuthorDirectory> | null = null;
  const result: CommentsImportResult = { dryRun, courses: [] };
  for (const course of courses) {
    const summary: CourseCommentsImport = {
      slug: course.slug,
      commentsInBronze: 0,
      unmatchedLessonComments: 0,
      authors: { matched: 0, staff: 0, unmatched: 0, ambiguous: 0 },
      unmatchedAuthorComments: 0,
      ambiguousAuthorComments: 0,
      unmatchedAuthors: [],
      ambiguousAuthors: [],
      replies: 0,
      orphanReplies: 0,
      skipped: 0,
      truncated: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      restored: 0,
    };
    result.courses.push(summary);
    if (!course.source_key) continue;

    const [bronze, lessons] = await Promise.all([
      repos.kajabiCourses.commentsOfCourse(course.source_key),
      repos.courses.lessonsOf([course.id], { source: "kajabi", includeHidden: true }),
    ]);
    const lessonIdByKey = new Map<string, string>(lessons.flatMap((l) => (l.source_key ? [[l.source_key, l.id] as [string, string]] : [])));
    summary.commentsInBronze = bronze.length;
    if (bronze.length === 0) continue;

    const existing = new Map<string, ImportedCommentRecord>(
      (await repos.courseComments.importedOf(KAJABI_COMMENT_SOURCE, [...lessonIdByKey.values()])).map((e) => [e.sourceKey, e]),
    );
    const candidates = candidateComments(bronze, lessonIdByKey, existing, summary);

    directory ??= loadDirectory(repos);
    const matches = matchAuthors(new Set(candidates.map((c) => c.authorKey).filter(Boolean)), await directory);
    const matched = [...matches.values()].flatMap((m) => (m.status === "matched" ? [m.memberId] : []));
    const staff = new Set(await staffAmong(repos, [...new Set(matched)]));
    const wanted = settleAuthors(candidates, matches, staff, summary);
    linkReplies(bronze, wanted, summary);

    const idOf = new Map<string, string>([...existing.values()].map((e) => [e.sourceKey, e.id]));
    // Top-level comments first, so a reply finds its comment's id; the second round is the replies.
    for (const replyRound of [false, true]) {
      const writes: ImportedCommentWrite[] = [];
      for (const w of wanted.filter((x) => (x.parentKey !== null) === replyRound)) {
        const row = existing.get(w.sourceKey);
        const parentId = w.parentKey ? (idOf.get(w.parentKey) ?? null) : null;
        // Kajabi's removal is the import's to apply or undo; a person's delete in the Hub is not.
        const deletedAt = row?.deletedBy ? row.deletedAt : w.removedInKajabi ? (row?.deletedAt ?? w.removedAt) : null;
        const desired: ImportedCommentWrite = {
          lessonId: w.lessonId,
          sourceKey: w.sourceKey,
          parentId,
          memberId: w.memberId,
          isStaffReply: w.isStaffReply,
          body: w.body,
          createdAt: w.createdAt,
          deletedAt,
        };
        if (!row) {
          writes.push(desired);
          summary.inserted++;
          continue;
        }
        const same =
          row.memberId === desired.memberId &&
          row.isStaffReply === desired.isStaffReply &&
          row.body === desired.body &&
          Date.parse(row.createdAt) === Date.parse(desired.createdAt) &&
          row.deletedAt === desired.deletedAt &&
          row.parentId === desired.parentId &&
          row.lessonId === desired.lessonId;
        if (same) {
          summary.unchanged++;
          continue;
        }
        writes.push(desired);
        summary.updated++;
        if (!row.deletedAt && deletedAt) summary.removed++;
        if (row.deletedAt && !deletedAt) summary.restored++;
      }
      if (!dryRun && writes.length > 0) {
        for (const written of await repos.courseComments.upsertImported(KAJABI_COMMENT_SOURCE, writes)) idOf.set(written.sourceKey, written.id);
      }
    }
  }
  return result;
}

/**
 * The Bronze comments of the lessons the Hub has that have text to import, before their author is settled. Fills the summary's
 * counts of what is left out or reshaped on the way (lessons not in the Hub, empty text, removed ones the Hub never had,
 * shortened text).
 */
function candidateComments(
  bronze: ImportableLessonComment[],
  lessonIdByKey: Map<string, string>,
  existing: Map<string, ImportedCommentRecord>,
  summary: CourseCommentsImport,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of bronze) {
    const lessonId = lessonIdByKey.get(c.lesson_kajabi_id);
    if (!lessonId) {
      summary.unmatchedLessonComments++;
      continue;
    }
    const sourceKey = sourceKeyOf(c.lesson_kajabi_id, c.comment_key);
    // Words Kajabi has since removed are not imported if the Hub never had them.
    if (c.deleted_at !== null && !existing.has(sourceKey)) {
      summary.skipped++;
      continue;
    }
    let body = plainCommentText(c.body);
    if (!body) {
      summary.skipped++;
      continue;
    }
    if (body.length > COMMENT_MAX_LENGTH) {
      body = `${body.slice(0, COMMENT_MAX_LENGTH - 1).trimEnd()}…`;
      summary.truncated++;
    }
    out.push({
      sourceKey,
      lessonId,
      authorKey: authorNameKey(c.author_name),
      authorName: displayName(c.author_name),
      body,
      createdAt: new Date(c.posted_at ?? c.captured_at).toISOString(),
      removedInKajabi: c.deleted_at !== null,
      removedAt: c.deleted_at ? new Date(c.deleted_at).toISOString() : null,
      bronze: c,
    });
  }
  return out;
}

/**
 * Keeps the comments whose author is one member and gives each its member and badge; the others are counted and their names
 * listed in the summary (most comments first), so none is dropped without being reported. Fills the summary's author counts.
 */
function settleAuthors(candidates: Candidate[], matches: Map<string, AuthorMatch>, staff: Set<string>, summary: CourseCommentsImport): Wanted[] {
  const settled: Wanted[] = [];
  const unmatched = new Map<string, UnsettledAuthor>();
  const ambiguous = new Map<string, UnsettledAuthor>();
  const matchedKeys = new Set<string>();
  const staffKeys = new Set<string>();
  for (const c of candidates) {
    const match: AuthorMatch = c.authorKey ? (matches.get(c.authorKey) ?? { status: "unmatched" }) : { status: "unmatched" };
    if (match.status === "matched") {
      matchedKeys.add(c.authorKey);
      const isStaffReply = staff.has(match.memberId);
      if (isStaffReply) staffKeys.add(c.authorKey);
      settled.push({ ...c, memberId: match.memberId, isStaffReply, parentKey: null });
      continue;
    }
    const bucket = match.status === "ambiguous" ? ambiguous : unmatched;
    const key = c.authorKey || `(${c.authorName})`;
    const entry = bucket.get(key) ?? { name: c.authorName, comments: 0, ...(match.status === "ambiguous" ? { members: match.members } : {}) };
    entry.comments++;
    bucket.set(key, entry);
    if (match.status === "ambiguous") summary.ambiguousAuthorComments++;
    else summary.unmatchedAuthorComments++;
  }
  const ranked = (m: Map<string, UnsettledAuthor>) => [...m.values()].sort((a, b) => b.comments - a.comments || a.name.localeCompare(b.name)).slice(0, AUTHOR_LIST_LIMIT);
  summary.authors = { matched: matchedKeys.size, staff: staffKeys.size, unmatched: unmatched.size, ambiguous: ambiguous.size };
  summary.unmatchedAuthors = ranked(unmatched);
  summary.ambiguousAuthors = ranked(ambiguous);
  return settled;
}

/**
 * One level of replies: a reply's comment is found by walking up Bronze's own nesting to the top-level comment (a reply to a
 * reply goes under the one above it). A comment that is not among the ones to import makes the reply a top-level comment.
 */
function linkReplies(bronze: ImportableLessonComment[], wanted: Wanted[], summary: CourseCommentsImport): void {
  const byKey = new Map<string, ImportableLessonComment>(bronze.map((c) => [sourceKeyOf(c.lesson_kajabi_id, c.comment_key), c]));
  const wantedByKey = new Map(wanted.map((w) => [w.sourceKey, w]));
  for (const w of wanted) {
    const row = w.bronze;
    if (!row.parent_comment_key) continue;
    summary.replies++;
    let parentKey = sourceKeyOf(row.lesson_kajabi_id, row.parent_comment_key);
    const seen = new Set<string>([w.sourceKey]);
    for (;;) {
      const above = byKey.get(parentKey)?.parent_comment_key;
      if (!above || seen.has(parentKey)) break;
      seen.add(parentKey);
      parentKey = sourceKeyOf(row.lesson_kajabi_id, above);
    }
    if (wantedByKey.has(parentKey) && parentKey !== w.sourceKey) w.parentKey = parentKey;
    else summary.orphanReplies++;
  }
}

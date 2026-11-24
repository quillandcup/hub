import { clock } from "@/lib/clock";
import { mentionIds } from "@/lib/courses/comment-text";
import { readersOf, staffAmong } from "@/lib/courses/comment-readers";
import type { ThreadEntry } from "@/lib/data/course-comments";
import type { Repos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";

/**
 * Mentions in lesson comments (docs/product/COURSES.md, "Phase 4, as built"). A mention is stored as `@[mbr_...]` in the text and
 * shown by the member's current display name. Only people who can open the lesson's course (current access, or staff) can be
 * mentioned, checked here when a comment is posted or edited and again when names are shown.
 */

/** Mentions in one comment: more is a wall of pings, not a conversation. */
export const MAX_MENTIONS = 5;
const MAX_SUGGESTIONS = 6;

export interface MentionChoice {
  memberId: string;
  /** The display name, the text the writer sees after picking. */
  name: string;
  /** Staff, shown with an Instructor badge. */
  isInstructor: boolean;
}

/** Of these members, who can open the course's lessons now. */
async function mentionable(repos: Repos, courseId: string, memberIds: string[], now: Date): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  return (await readersOf(repos, [courseId], memberIds, now)).get(courseId) ?? new Set();
}

/** The error to show when a comment's mentions aren't allowed (too many, or someone who can't open the course), else null. */
export async function mentionError(repos: Repos, courseId: string, body: string, now = new Date(clock.now())): Promise<string | null> {
  const ids = mentionIds(body);
  if (ids.length === 0) return null;
  if (ids.length > MAX_MENTIONS) return `Mention up to ${MAX_MENTIONS} people in one comment`;
  const allowed = await mentionable(repos, courseId, ids, now);
  return ids.every((id) => allowed.has(id)) ? null : "You can only mention people who are in this course";
}

/**
 * Display names for the mentions in a thread, for members who can still open the course. Someone who can't (access ended, left,
 * or an id that was never a course member) is absent, and the thread shows "@someone", so a comment can't be used to look names up.
 */
export async function mentionNames(repos: Repos, courseId: string, entries: ThreadEntry[], now = new Date(clock.now())): Promise<Record<string, string>> {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const comment of [entry.comment, ...entry.replies]) {
      if (comment.body) for (const id of mentionIds(comment.body)) ids.add(id);
    }
  }
  if (ids.size === 0) return {};
  const allowed = await mentionable(repos, courseId, [...ids], now);
  const people = await repos.members.byIds([...allowed]);
  return Object.fromEntries(people.map((m) => [m.id, getMemberDisplayName({ name: m.name, display_name: m.displayName })]));
}

/** Names that start with what was typed first, then ones with it at a word start, then the rest. */
function rank(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower.startsWith(query)) return 0;
  return lower.split(/[\s_-]+/).some((word) => word.startsWith(query)) ? 1 : 2;
}

/** People in the course whose name matches what was typed after the `@`, never the writer. */
export async function suggestMentionable(repos: Repos, courseId: string, selfId: string, typed: string, now = new Date(clock.now())): Promise<MentionChoice[]> {
  const query = typed.trim().toLowerCase().slice(0, 40);
  if (query.length === 0) return [];
  const matches = (await repos.directory.matching(query, 40)).filter((m) => m.id !== selfId);
  const ids = matches.map((m) => m.id);
  const [allowed, staff] = await Promise.all([mentionable(repos, courseId, ids, now), staffAmong(repos, ids)]);
  const staffIds = new Set(staff);
  return matches
    .filter((m) => allowed.has(m.id))
    .map((m) => ({ memberId: m.id, name: getMemberDisplayName({ name: m.name, display_name: m.display_name }), isInstructor: staffIds.has(m.id) }))
    .sort((a, b) => rank(a.name, query) - rank(b.name, query) || Number(b.isInstructor) - Number(a.isInstructor) || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);
}

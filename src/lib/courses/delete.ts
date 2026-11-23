import type { Repos } from "@/lib/data/repos";

/**
 * What deleting a course would remove and whether it may go, worked out without changing anything (the numbers the confirmation
 * shows, and the reasons beside the menu item). Deleting is `delete_course` (migrations 20271123000000 and 20271123100000): a
 * Hub-owned draft course that nobody has access to, removed with its modules and lessons and whatever was left on them.
 */
export interface DeletePreview {
  modules: number;
  lessons: number;
  /** Where the course comes from: only the Hub's own can be deleted here. */
  source: string;
  /** True while members can't see the course. */
  isDraft: boolean;
  /** People with access (due access included), and people with a grant. Either blocks the delete. */
  access: number;
  grants: number;
  /** What was left on its lessons, deleted with the course: lesson progress, comments, and chat messages that share a lesson's video. */
  progress: number;
  comments: number;
  chatVideos: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What goes with the course beyond its modules and lessons, in plain words; empty when nothing was left on it. */
export function deleteLosses(preview: Pick<DeletePreview, "progress" | "comments" | "chatVideos">): string {
  const gone = [preview.progress > 0 && plural(preview.progress, "lesson progress record"), preview.comments > 0 && plural(preview.comments, "comment")].filter(Boolean);
  const sentences: string[] = [];
  if (gone.length > 0) sentences.push(`${gone.join(" and ")} on its lessons ${preview.progress + preview.comments === 1 ? "is" : "are"} deleted too.`);
  if (preview.chatVideos > 0) sentences.push(`${plural(preview.chatVideos, "chat message")} will lose ${preview.chatVideos === 1 ? "its" : "their"} video link (the ${preview.chatVideos === 1 ? "message stays" : "messages stay"}).`);
  return sentences.join(" ");
}

/** The preview for a course, or null for an unknown one. */
export async function loadDeletePreview(repos: Pick<Repos, "courses">, courseId: string): Promise<DeletePreview | null> {
  const course = await repos.courses.courseById(courseId);
  if (!course) return null;
  const [modules, lessons, used] = await Promise.all([
    repos.courses.modulesOf([courseId], { includeHidden: true }),
    repos.courses.lessonsOf([courseId], { includeHidden: true }),
    repos.courses.memberDataOf(courseId),
  ]);
  return { modules: modules.length, lessons: lessons.length, source: course.source, isDraft: course.is_draft, ...used };
}

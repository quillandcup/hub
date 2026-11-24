import { QUIZ_ANSWERS } from "@/lib/config";

/**
 * Files members upload as quiz answers (docs/product/COURSES.md, "Quizzes"). Client safe: no server imports.
 *
 * They live in the private `quiz-answer-files` bucket, which has no storage policy, so only the server reaches it. The browser
 * uploads straight to storage with a signed link the server made for one path (a server action can't take a big body), the
 * quiz submission then names that path, and the server checks it is the member's own and really there before recording it.
 * A file is `<member id>/<random>/<name>`: the member's own folder, so a removal request deletes the whole folder, and an
 * address that can't be guessed. Staff and the member read it through `/api/course-quiz-answers/...`, never by a public link.
 */

export const QUIZ_ANSWER_FILES_BUCKET = "quiz-answer-files";

/** A file name as it is stored: letters, digits, dot, dash and underscore only, so a path can't carry anything odd. */
export function safeQuizFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-120);
  return cleaned || "file";
}

/** The extension of a file name in lower case, without the dot; "" when it has none. */
export function fileExtensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export type QuizFileCheck = { ok: true } | { ok: false; error: string };

/** Whether a file of this name and size can be an answer, in the words shown to the member. */
export function checkQuizFile(name: string, bytes: number): QuizFileCheck {
  if (!name || !Number.isFinite(bytes) || bytes < 0) return { ok: false, error: "That file couldn't be read." };
  if (bytes === 0) return { ok: false, error: "That file is empty." };
  if (bytes > QUIZ_ANSWERS.maxFileBytes) return { ok: false, error: `Files can be up to ${QUIZ_ANSWERS.maxFileBytes / (1024 * 1024)} MB.` };
  if (!(QUIZ_ANSWERS.fileExtensions as readonly string[]).includes(fileExtensionOf(name))) {
    return { ok: false, error: `Upload a document or a picture (${QUIZ_ANSWERS.fileExtensions.join(", ")}).` };
  }
  return { ok: true };
}

/** Where a member's file goes: their folder, a random folder (128 bits of a UUID), the cleaned name. */
export function newQuizFilePath(memberId: string, name: string, random: string): string {
  return `${memberId}/${random}/${safeQuizFileName(name)}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a path is one `newQuizFilePath` makes for this member: the only paths a submission may name. */
export function isOwnQuizFilePath(memberId: string, path: unknown): path is string {
  return typeof path === "string" && new RegExp(`^${escapeRegExp(memberId)}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$`).test(path);
}

/** A file an answer names: what the browser says it uploaded (the server checks it against storage). */
export interface UploadedFileRef {
  path: string;
  /** The name the member's file had, for showing it back. */
  name: string;
  bytes: number;
}

/**
 * The path and token the server handed out for an upload, accepted only when they are the shapes the server makes: three plain
 * path segments (a member id, a random folder, a file name) and a signed token's characters. The address the browser sends the file to
 * is built from nothing else, so a response that was tampered with can't point it anywhere.
 */
export function uploadTargetFrom(path: unknown, token: unknown): { path: string; token: string } | null {
  if (typeof path !== "string" || typeof token !== "string") return null;
  if (!/^[A-Za-z0-9_]{1,40}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(path)) return null;
  if (!/^[A-Za-z0-9._-]{10,4000}$/.test(token)) return null;
  return { path, token };
}

/** A quiz attempt id (`qatt_` and 12 base58 characters). Tier 2: used between the app's own pages and routes, so not one of `ids.ts`'s prefixes. */
export const isAttemptId = (value: unknown): value is string => typeof value === "string" && /^qatt_[1-9A-HJ-NP-Za-km-z]{12}$/.test(value);

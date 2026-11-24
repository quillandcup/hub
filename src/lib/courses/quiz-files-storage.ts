import type { SupabaseClient } from "@supabase/supabase-js";
import { QUIZ_ANSWER_FILES_BUCKET } from "@/lib/courses/quiz-files";

/**
 * The server's side of quiz answer files (`src/lib/courses/quiz-files.ts` has the rules and the paths). Every function takes a
 * service-role client: the bucket has no storage policy, so nothing else reaches it.
 */

/** How long the link a download redirects to stays valid: long enough to start the download. */
export const QUIZ_FILE_LINK_SECONDS = 60;

/** A signed address the browser uploads one file to, or null when storage refused. */
export async function signQuizFileUpload(storage: SupabaseClient, path: string): Promise<{ token: string } | null> {
  const { data, error } = await storage.storage.from(QUIZ_ANSWER_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("couldn't sign a quiz file upload:", error?.message);
    return null;
  }
  return { token: data.token };
}

/** The size storage holds for a path, or null when nothing is there (the browser's word is never taken for it). Throws when storage can't be read. */
export async function quizFileSize(storage: SupabaseClient, path: string): Promise<{ bytes: number } | null> {
  const slash = path.lastIndexOf("/");
  const { data, error } = await storage.storage.from(QUIZ_ANSWER_FILES_BUCKET).list(path.slice(0, slash), { limit: 20 });
  if (error) throw new Error(error.message);
  const found = data?.find((f) => f.name === path.slice(slash + 1));
  const bytes = (found?.metadata as { size?: unknown } | null | undefined)?.size;
  return typeof bytes === "number" ? { bytes } : null;
}

/** A short-lived link that saves the file under its own name (never shown in the browser, so a file can't run as a page), or null when storage refused. */
export async function signedQuizFileDownload(storage: SupabaseClient, path: string, fileName: string): Promise<string | null> {
  const { data, error } = await storage.storage.from(QUIZ_ANSWER_FILES_BUCKET).createSignedUrl(path, QUIZ_FILE_LINK_SECONDS, { download: fileName });
  if (error || !data) {
    console.error("couldn't sign a quiz file link:", error?.message);
    return null;
  }
  return data.signedUrl;
}

/** Deletes files (an attempt or a quiz that went away); returns how many paths were handed over. A failure is logged: the rows are already gone. */
export async function removeQuizFiles(storage: SupabaseClient, paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const { error } = await storage.storage.from(QUIZ_ANSWER_FILES_BUCKET).remove(paths);
  if (error) console.error("couldn't delete quiz files:", error.message);
  return paths.length;
}

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { COURSE_FILES_BUCKET, MAX_COURSE_FILE_BYTES, UPLOADED_FILE_KEY, contentTypeFor, parseLessonFileUpload, storagePathFor } from "@/lib/courses/files";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The downloads of a Hub-owned lesson. The file goes from the browser straight into the private
 * `course-files` bucket through a one-use signed upload (a server action can't carry a file of this size),
 * and is recorded once it is there: its size comes from the bucket, not from what the browser said. Members
 * get it through the same lesson download route as an imported lesson's files. The bucket and `course_lesson_files`
 * are written with the service role, after the admin check.
 */

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;
export type FileUploadStart = { error?: string; fileKey?: string; path?: string; token?: string };
export type FileResult = { error?: string; id?: string };

const NOT_EDITABLE = "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi.";

function revalidate(courseId: string, lessonId: string) {
  revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`);
  revalidatePath("/courses", "layout");
}

/** The lesson, when it is a Hub-owned lesson of this course. */
async function hubLesson(auth: Auth, courseId: string, lessonId: string) {
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return null;
  const lesson = await createRepos(auth.supabase).courses.lessonById(lessonId);
  return lesson && lesson.course_id === courseId && lesson.source === "hub" ? lesson : null;
}

async function startImpl(auth: Auth, courseId: string, lessonId: string, file: { filename: string; size: number }): Promise<FileUploadStart> {
  if (!(await hubLesson(auth, courseId, lessonId))) return { error: NOT_EDITABLE };
  const parsed = parseLessonFileUpload(file);
  if (!parsed.ok) return { error: parsed.error };

  const fileKey = `up-${randomUUID()}`;
  const path = storagePathFor(courseId, lessonId, fileKey, parsed.filename);
  const { data, error } = await createServiceRoleClient().storage.from(COURSE_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("lesson file: couldn't make an upload address:", error?.message);
    return { error: "Couldn't start the upload." };
  }
  return { fileKey, path, token: data.token };
}

async function finishImpl(auth: Auth, courseId: string, lessonId: string, file: { fileKey: string; filename: string; type: string }): Promise<FileResult> {
  if (!(await hubLesson(auth, courseId, lessonId))) return { error: NOT_EDITABLE };
  const parsed = parseLessonFileUpload({ filename: file.filename, size: 1 });
  if (!parsed.ok || typeof file.fileKey !== "string" || !UPLOADED_FILE_KEY.test(file.fileKey)) return { error: "That upload isn't one this lesson started." };

  const path = storagePathFor(courseId, lessonId, file.fileKey, parsed.filename);
  const supabase = createServiceRoleClient();
  const bucket = supabase.storage.from(COURSE_FILES_BUCKET);
  try {
    // What arrived, by the bucket's own account.
    const stored = (await bucket.list(`${courseId}/${lessonId}`, { search: path.split("/").pop() })).data?.find((o) => `${courseId}/${lessonId}/${o.name}` === path);
    const size = Number((stored?.metadata as { size?: number } | null | undefined)?.size);
    if (!stored || !Number.isFinite(size)) return { error: "The file didn't arrive. Try again." };
    if (size > MAX_COURSE_FILE_BYTES) {
      await bucket.remove([path]);
      return { error: "That file is too large." };
    }

    const courses = createRepos(supabase).courses;
    const position = Math.max(0, ...(await courses.lessonFiles(lessonId)).map((f) => f.position)) + 1;
    await courses.saveLessonFile({
      lesson_id: lessonId,
      source_key: file.fileKey,
      filename: parsed.filename,
      content_type: contentTypeFor(parsed.filename, file.type),
      size_bytes: size,
      storage_path: path,
      position,
    });
    revalidate(courseId, lessonId);
    return { id: lessonId };
  } catch (error) {
    console.error("lesson file: couldn't record an upload:", error instanceof Error ? error.message : error);
    // Nothing points at the object: don't leave it behind.
    await bucket.remove([path]).catch(() => undefined);
    return { error: "Couldn't save the file." };
  }
}

async function removeImpl(auth: Auth, courseId: string, lessonId: string, fileId: string): Promise<FileResult> {
  if (!(await hubLesson(auth, courseId, lessonId))) return { error: NOT_EDITABLE };
  if (!isId(fileId, "file")) return { error: "Not found." };
  try {
    const supabase = createServiceRoleClient();
    const courses = createRepos(supabase).courses;
    const file = await courses.lessonFile(lessonId, fileId);
    if (!file) return { error: "Not found." };
    // The row first: if that fails the file is still whole and listed; an object left behind by a failed second step is only unreferenced.
    await courses.deleteLessonFile(file.id);
    await supabase.storage.from(COURSE_FILES_BUCKET).remove([file.storage_path]);
  } catch (error) {
    console.error("lesson file: couldn't remove a file:", error instanceof Error ? error.message : error);
    return { error: "Couldn't remove the file." };
  }
  revalidate(courseId, lessonId);
  return { id: fileId };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** A one-use address to send a file to, and the key that names it. */
export async function startLessonFileUpload(courseId: string, lessonId: string, file: { filename: string; size: number }): Promise<FileUploadStart> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_file_upload_started", () => startImpl(auth, courseId, lessonId, file));
}

/** Records a file that has arrived in the bucket as one of the lesson's downloads. */
export async function finishLessonFileUpload(courseId: string, lessonId: string, file: { fileKey: string; filename: string; type: string }): Promise<FileResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_file_added", () => finishImpl(auth, courseId, lessonId, file));
}

/** Removes one of the lesson's downloads, from the bucket and the lesson. */
export async function removeLessonFile(courseId: string, lessonId: string, fileId: string): Promise<FileResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_file_removed", () => removeImpl(auth, courseId, lessonId, fileId));
}

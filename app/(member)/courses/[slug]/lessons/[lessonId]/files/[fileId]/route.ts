import { NextRequest, NextResponse } from "next/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { loadLessonView } from "@/lib/courses/member";
import { COURSE_FILES_BUCKET } from "@/lib/courses/files";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/chat/format";

/** How long the link a member is sent to stays valid: long enough to start the download. */
const SIGNED_URL_SECONDS = 60;

/**
 * A lesson download. The bucket is private, so every download comes through here: check the member
 * can open this lesson (the same rule as the lesson page: access, not ended, open; staff also
 * preview coming-soon lessons), then redirect to a signed link that expires in a minute and saves
 * the file under its own name. Anything else is a plain 404, never revealing what exists.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string; lessonId: string; fileId: string }> }) {
  const { slug, lessonId, fileId } = await params;
  if (!isUuid(lessonId) || !isUuid(fileId)) return new NextResponse("Not found", { status: 404 });

  const caller = await getCoursesCaller();
  if (!caller) return new NextResponse("Not found", { status: 404 });

  const supabase = createServiceRoleClient();
  const lesson = await loadLessonView(supabase, slug, lessonId, caller.scope);
  if (lesson.kind !== "ok") return new NextResponse("Not found", { status: 404 });

  const { data: file } = await supabase.from("course_lesson_files").select("filename, storage_path").eq("id", fileId).eq("lesson_id", lessonId).maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage.from(COURSE_FILES_BUCKET).createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, { download: file.filename });
  if (error || !data) {
    console.error("Couldn't sign a course file link:", error?.message);
    return new NextResponse("Couldn't prepare the download", { status: 502 });
  }
  const response = NextResponse.redirect(data.signedUrl, 302);
  // The redirect target is single-use and short-lived: never let a cache keep it.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

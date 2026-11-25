import { NextResponse } from "next/server";
import { requireActionPermission } from "@/lib/admin-auth";
import { getCoursesCaller } from "@/lib/courses/caller";
import { isQuestionId } from "@/lib/courses/quiz-editor";
import { isAttemptId } from "@/lib/courses/quiz-files";
import { signedQuizFileDownload } from "@/lib/courses/quiz-files-storage";
import { createRepos } from "@/lib/data/repos";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * A file a member uploaded as a quiz answer. The bucket is private, so every download comes through here: only the member the attempt
 * belongs to, or staff who manage courses, are sent to a signed link that expires in a minute and saves the file under its own
 * name. Anyone else, and anything that doesn't exist, gets the same plain 404, so nothing is revealed about what is there.
 * (A member keeps their own file even after their access to the course ends: it is their writing.)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ attemptId: string; questionId: string }> }) {
  const { attemptId, questionId } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404 });
  // A question of the quiz, or `pos_<n>`: an imported answer kept by its place because no question could be matched to it.
  const position = /^pos_(\d{1,4})$/.exec(questionId)?.[1];
  if (!isAttemptId(attemptId) || !(isQuestionId(questionId) || position)) return notFound();

  // Who is asking comes first: the member's session, or staff who manage courses. Neither is nobody.
  const caller = await getCoursesCaller();
  const isStaff = (await requireActionPermission("courses.manage")).ok;
  if (!caller && !isStaff) return notFound();

  const service = createServiceRoleClient();
  const repos = createRepos(service);
  const attempt = await repos.quizzes.attemptById(attemptId);
  if (!attempt) return notFound();
  const isOwner = !!caller && caller.identity.memberId === attempt.memberId;
  if (!isOwner && !isStaff) return notFound();

  const file = position
    ? attempt.unlinkedAnswers.find((u) => u.position === Number(position))?.file
    : (await repos.quizzes.answersOfAttempts([attemptId])).find((a) => a.questionId === questionId)?.file;
  if (!file) return notFound();

  const url = await signedQuizFileDownload(service, file.path, file.name);
  if (!url) return new NextResponse("Couldn't prepare the download", { status: 502 });
  const response = NextResponse.redirect(url, 302);
  // The redirect target is short-lived and names a member's file: never let a cache keep it.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

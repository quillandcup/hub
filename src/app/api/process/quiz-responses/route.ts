import { NextRequest, NextResponse } from "next/server";
import { QuizResponseImportError, importKajabiQuizResponses } from "@/lib/courses/quiz-response-import";
import { QUIZ_ANSWER_FILES_BUCKET } from "@/lib/courses/quiz-files";
import { createRepos } from "@/lib/data/repos";
import { requireApiPermission } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 300;

/**
 * Bronze Kajabi quiz responses -> Local quiz attempts (docs/product/COURSES.md, "Importing past quiz responses"). Body:
 * `{ "course": "self-editing-academy", "dryRun": true }`; `course` is the Silver slug (omit it for every Kajabi course); `dryRun`
 * counts without writing. The answer is counts only: never a name, an email, an answer or a file name.
 *
 * Insert only and repeatable: a submission is added once, never changes an attempt that exists, and a responder with no Hub member
 * yet stays in Bronze until there is one (see `importKajabiQuizResponses`). The caller is checked as an admin, then the writes use the
 * service role.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "data.pipeline.run");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const courseSlug = typeof body?.course === "string" && body.course ? body.course : undefined;
  const dryRun = body?.dryRun === true;

  try {
    const service = createServiceRoleClient();
    const result = await importKajabiQuizResponses(
      createRepos(service),
      {
        copyFile: async (from, to) => {
          const { error } = await service.storage.from(QUIZ_ANSWER_FILES_BUCKET).copy(from, to);
          if (error) console.error("copying a quiz answer file failed:", error.message);
          return !error;
        },
        randomId: () => crypto.randomUUID(),
      },
      { courseSlug, dryRun },
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof QuizResponseImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Quiz responses import failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Processing failed" }, { status: 500 });
  }
}

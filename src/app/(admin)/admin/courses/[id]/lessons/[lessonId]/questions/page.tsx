import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import QuizLessonPage, { quizTabMetadata } from "../QuizLessonPage";

type Params = { params: Promise<{ id: string; lessonId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, lessonId } = await params;
  return quizTabMetadata(id, lessonId, "questions");
}

/** A quiz lesson's Questions tab. */
export default async function QuizQuestionsPage({ params }: Params) {
  await requirePermission("courses.manage");
  const { id, lessonId } = await params;
  return <QuizLessonPage idParam={id} lessonId={lessonId} tab="questions" />;
}

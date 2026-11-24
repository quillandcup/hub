import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import QuizLessonPage, { quizTabMetadata } from "../QuizLessonPage";

type Params = { params: Promise<{ id: string; lessonId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, lessonId } = await params;
  return quizTabMetadata(id, lessonId, "settings");
}

/** A quiz lesson's Settings tab. */
export default async function QuizSettingsPage({ params }: Params) {
  await requirePermission("courses.manage");
  const { id, lessonId } = await params;
  return <QuizLessonPage idParam={id} lessonId={lessonId} tab="settings" />;
}

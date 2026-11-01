import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isId } from "@/lib/ids";
import renderLessonStats, { type LessonStatsQuery } from "../LessonStats";

export const metadata: Metadata = { title: "Lesson watch stats · Courses" };

/** A lesson's watch stats as a page: where a direct link or a refresh lands. From the app it opens as a modal (`@modal/(.)stats/[lessonId]`). */
export default async function LessonWatchStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<LessonStatsQuery>;
}) {
  await requireAdminPage();
  const { id, lessonId } = await params;
  if (!isId(lessonId, "les")) notFound();
  return renderLessonStats({ id, lessonId, query: await searchParams, variant: "page" });
}

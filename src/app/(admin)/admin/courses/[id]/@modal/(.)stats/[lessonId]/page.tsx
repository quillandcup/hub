import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isId } from "@/lib/ids";
import renderLessonStats, { type LessonStatsQuery } from "../../../stats/LessonStats";

/** The lesson's watch stats in a modal over the page the link was clicked on (the builder, the course's stats). A direct load renders the full page instead. */
export default async function LessonWatchStatsModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<LessonStatsQuery>;
}) {
  await requireAdminPage();
  const { id, lessonId } = await params;
  if (!isId(lessonId, "les")) notFound();
  return renderLessonStats({ id, lessonId, query: await searchParams, variant: "modal" });
}

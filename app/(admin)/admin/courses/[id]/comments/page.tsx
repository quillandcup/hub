import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { redirectLegacyTabParam, tabTitle } from "@/lib/tab-routes";
import CommentsPage from "./CommentsPage";
import { COMMENT_TAB_IDS, COMMENT_TAB_LABELS, COMMENTS_TITLE } from "./tabs";

export const metadata: Metadata = { title: tabTitle({ section: COMMENTS_TITLE }, COMMENT_TAB_LABELS.unanswered, true) };

/** A course's comments, first tab: the questions nobody on staff has answered. Admin only. */
export default async function CourseCommentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  redirectLegacyTabParam(`/admin/courses/${id}/comments`, COMMENT_TAB_IDS, await searchParams);
  // Called, not rendered, so the page itself returns the finished tree (and a test can render it).
  return CommentsPage({ idParam: id, tab: "unanswered" });
}

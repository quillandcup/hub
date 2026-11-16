import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import CommentsPage from "../CommentsPage";
import { COMMENT_TAB_LABELS, COMMENTS_TITLE } from "../tabs";

export const metadata: Metadata = { title: tabTitle({ section: COMMENTS_TITLE }, COMMENT_TAB_LABELS.moderation, false) };

/** A course's comments, Moderation tab: open reports and comments held for review. Admin only. */
export default async function CourseCommentsModerationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  return CommentsPage({ idParam: id, tab: "moderation" });
}

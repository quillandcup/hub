import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import MentorshipPage from "../MentorshipPage";
import { MENTORSHIP_TAB_LABELS, MENTORSHIP_TITLE } from "../tabs";

export const metadata: Metadata = {
  title: tabTitle({ section: MENTORSHIP_TITLE }, MENTORSHIP_TAB_LABELS.volunteers, false),
};

export default async function AdminMentorshipVolunteersPage() {
  await requireAdminPage();
  return <MentorshipPage tab="volunteers" />;
}

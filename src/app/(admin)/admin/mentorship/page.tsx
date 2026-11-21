import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import MentorshipPage from "./MentorshipPage";
import { MENTORSHIP_TAB_LABELS, MENTORSHIP_TITLE } from "./tabs";

export const metadata: Metadata = {
  title: tabTitle({ section: MENTORSHIP_TITLE }, MENTORSHIP_TAB_LABELS.matches, true),
};

// ?new=<member id> opens the add form with that new member filled in (the Work Queue's "Assign" link).
export default async function AdminMentorshipPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  await requireAdminPage();
  const { new: newMember } = await searchParams;
  return (
    <MentorshipPage
      tab="matches"
      prefill={{ newMemberId: Array.isArray(newMember) ? newMember[0] : newMember }}
    />
  );
}

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin-auth";
import { staffCan } from "@/lib/staff-access";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("activity");

/**
 * ?page=&pageSize= page the member's activity feed (see src/lib/activity-feed.ts). An admin sees everything; a community manager
 * with `member.activity_tab_limited` sees the member's own activity only (get_activity_feed enforces it); without either
 * feature the tab is not hers, so she goes to the member's Overview.
 */
export default async function MemberActivityPage({ params, searchParams }: PageProps<"/admin/members/[id]/activity">) {
  const { role } = await requirePermission("members.read");
  const { id } = await params;
  if (!staffCan(role, "member.activity_tab") && !staffCan(role, "member.activity_tab_limited")) redirect(`/admin/members/${id}`);
  return <MemberDetailPage id={id} tab="activity" searchParams={await searchParams} />;
}

import { requirePermission } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("slack");

/** ?type=&channel=&sort=&dir=&page=&pageSize= filter, sort and page the member's Slack activity (src/lib/slack-activity-table.ts). */
export default async function MemberSlackPage({ params, searchParams }: PageProps<"/admin/members/[id]/slack">) {
  await requirePermission("members.read");
  const { id } = await params;
  return <MemberDetailPage id={id} tab="slack" searchParams={await searchParams} />;
}

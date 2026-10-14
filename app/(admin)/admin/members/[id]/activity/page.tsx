import { requireAdminPage } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("activity");

/** ?page=&pageSize= page the member's activity feed (see lib/activity-feed.ts). */
export default async function MemberActivityPage({ params, searchParams }: PageProps<"/admin/members/[id]/activity">) {
  await requireAdminPage();
  const { id } = await params;
  return <MemberDetailPage id={id} tab="activity" searchParams={await searchParams} />;
}

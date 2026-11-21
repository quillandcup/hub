import { requireAdminPage } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("notifications");

export default async function MemberNotificationsPage({ params }: PageProps<"/admin/members/[id]/notifications">) {
  await requireAdminPage();
  const { id } = await params;
  return <MemberDetailPage id={id} tab="notifications" />;
}

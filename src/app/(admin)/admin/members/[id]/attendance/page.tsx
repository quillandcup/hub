import { requireStaffPage } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("attendance");

export default async function MemberAttendancePage({ params }: PageProps<"/admin/members/[id]/attendance">) {
  await requireStaffPage();
  const { id } = await params;
  return <MemberDetailPage id={id} tab="attendance" />;
}

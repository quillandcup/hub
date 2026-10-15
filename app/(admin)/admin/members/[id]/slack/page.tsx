import { requireAdminPage } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("slack");

export default async function MemberSlackPage({ params }: PageProps<"/admin/members/[id]/slack">) {
  await requireAdminPage();
  const { id } = await params;
  return <MemberDetailPage id={id} tab="slack" />;
}

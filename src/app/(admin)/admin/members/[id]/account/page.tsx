import { requirePermission } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("account");

export default async function MemberAccountPage({ params }: PageProps<"/admin/members/[id]/account">) {
  await requirePermission("member.account_tab");
  const { id } = await params;
  return <MemberDetailPage id={id} tab="account" />;
}

import { requireAdminPage } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("identity");

export default async function MemberIdentityPage({ params }: PageProps<"/admin/members/[id]/identity">) {
  await requireAdminPage();
  const { id } = await params;
  return <MemberDetailPage id={id} tab="identity" />;
}

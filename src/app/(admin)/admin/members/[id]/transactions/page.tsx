import { requirePermission } from "@/lib/admin-auth";
import MemberDetailPage, { memberTabMetadata } from "../MemberDetailPage";

export const generateMetadata = memberTabMetadata("transactions");

export default async function MemberTransactionsPage({ params }: PageProps<"/admin/members/[id]/transactions">) {
  await requirePermission("member.transactions_tab");
  const { id } = await params;
  return <MemberDetailPage id={id} tab="transactions" />;
}

import { requireAdminPage } from "@/lib/admin-auth";
import { redirectLegacyTabParam } from "@/lib/tab-routes";
import MemberDetailPage, { memberTabMetadata } from "./MemberDetailPage";
import { MEMBER_TAB_IDS } from "./tabs";

export const generateMetadata = memberTabMetadata("overview");

/** Member detail, Overview tab. Legacy ?tab=<id> links redirect to /admin/members/<id>/<tab>. */
export default async function MemberOverviewPage({ params, searchParams }: PageProps<"/admin/members/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  redirectLegacyTabParam(`/admin/members/${id}`, MEMBER_TAB_IDS, await searchParams);
  return <MemberDetailPage id={id} tab="overview" />;
}

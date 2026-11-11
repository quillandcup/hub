import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/admin-auth";
import { redirectLegacyTabParam } from "@/lib/tab-routes";
import CarePage from "./CarePage";
import { CARE_TAB_IDS, CARE_TITLE } from "./tabs";

export const metadata: Metadata = { title: CARE_TITLE };

/** Hedgie Care, Active tab. A legacy ?tab=earlier link redirects to /admin/care/earlier. */
export default async function CareIndex({ searchParams }: PageProps<"/admin/care">) {
  const staff = await requireStaffPage();
  redirectLegacyTabParam("/admin/care", CARE_TAB_IDS, await searchParams);
  return <CarePage tab="active" staff={staff} />;
}

import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/admin-auth";
import { isId } from "@/lib/ids";
import { redirectLegacyTabParam } from "@/lib/tab-routes";
import CarePage from "./CarePage";
import { CARE_TAB_IDS, CARE_TITLE } from "./tabs";

export const metadata: Metadata = { title: CARE_TITLE };

/** Hedgie Care, Active tab. A legacy ?tab=earlier link redirects to /admin/care/earlier. `?member=` shows one member's care plans. */
export default async function CareIndex({ searchParams }: PageProps<"/admin/care">) {
  const staff = await requireStaffPage();
  const params = await searchParams;
  redirectLegacyTabParam("/admin/care", CARE_TAB_IDS, params);
  return <CarePage tab="active" staff={staff} memberId={typeof params.member === "string" && isId(params.member, "mbr") ? params.member : undefined} />;
}

import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/admin-auth";
import { isId } from "@/lib/ids";
import { tabTitle } from "@/lib/tab-routes";
import CarePage from "../CarePage";
import { CARE_TAB_LABELS, CARE_TITLE } from "../tabs";

export const metadata: Metadata = { title: tabTitle({ section: CARE_TITLE }, CARE_TAB_LABELS.earlier, false) };

/** Hedgie Care, Earlier tab: care plans that were closed, and ones that lapsed. `?member=` shows one member's. */
export default async function CareEarlierPage({ searchParams }: PageProps<"/admin/care/earlier">) {
  const staff = await requireStaffPage();
  const params = await searchParams;
  return <CarePage tab="earlier" staff={staff} memberId={typeof params.member === "string" && isId(params.member, "mbr") ? params.member : undefined} />;
}

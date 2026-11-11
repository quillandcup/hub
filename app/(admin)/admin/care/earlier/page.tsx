import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import CarePage from "../CarePage";
import { CARE_TAB_LABELS, CARE_TITLE } from "../tabs";

export const metadata: Metadata = { title: tabTitle({ section: CARE_TITLE }, CARE_TAB_LABELS.earlier, false) };

/** Hedgie Care, Earlier tab: engagements that were closed, and ones that lapsed. */
export default async function CareEarlierPage() {
  const staff = await requireStaffPage();
  return <CarePage tab="earlier" staff={staff} />;
}

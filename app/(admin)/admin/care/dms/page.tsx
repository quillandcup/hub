import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import CarePage from "../CarePage";
import { CARE_TAB_LABELS, CARE_TITLE } from "../tabs";

export const metadata: Metadata = { title: tabTitle({ section: CARE_TITLE }, CARE_TAB_LABELS.dms, false) };

/** Hedgie Care, Your DMs tab: her 1:1 Slack DMs with members, to choose which ones fill in who spoke last. */
export default async function CareDmsPage() {
  const staff = await requireStaffPage();
  return <CarePage tab="dms" staff={staff} />;
}

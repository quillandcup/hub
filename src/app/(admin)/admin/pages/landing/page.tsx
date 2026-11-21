import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import PagesAdminPage, { PAGES_SECTION, PAGES_TAB_LABELS } from "../PagesAdminPage";

export const metadata: Metadata = { title: tabTitle({ section: PAGES_SECTION }, PAGES_TAB_LABELS.landing, false) };

export default async function AdminLandingPagesPage() {
  await requireAdminPage();
  return PagesAdminPage({ tab: "landing" });
}

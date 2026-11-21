import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { tabTitle } from "@/lib/tab-routes";
import PagesAdminPage, { PAGES_SECTION, PAGES_TAB_LABELS } from "../PagesAdminPage";

export const metadata: Metadata = { title: tabTitle({ section: PAGES_SECTION }, PAGES_TAB_LABELS.design, false) };

export default async function AdminSiteDesignPage() {
  await requireAdminPage();
  return PagesAdminPage({ tab: "design" });
}

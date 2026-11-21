import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import PagesAdminPage, { PAGES_SECTION } from "./PagesAdminPage";

export const metadata: Metadata = { title: PAGES_SECTION };

export default async function AdminPagesPage() {
  await requireAdminPage();
  return PagesAdminPage({ tab: "website" });
}

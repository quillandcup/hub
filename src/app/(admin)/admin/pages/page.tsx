import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import PagesAdminPage, { PAGES_SECTION } from "./PagesAdminPage";

export const metadata: Metadata = { title: PAGES_SECTION };

export default async function AdminPagesPage() {
  await requirePermission("pages.read");
  return PagesAdminPage({ tab: "website" });
}

import type { Metadata } from "next";
import MemberOverridesClient from "./MemberOverridesClient";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Member Status Overrides",
};

export default async function MemberOverridesPage() {
  await requireAdminPage();
  return <MemberOverridesClient />;
}

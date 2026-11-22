import type { Metadata } from "next";
import MemberOverridesClient from "./MemberOverridesClient";
import { requirePermission } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Member Status Overrides",
};

export default async function MemberOverridesPage() {
  await requirePermission("members.overrides.manage");
  return <MemberOverridesClient />;
}

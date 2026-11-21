import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import UsersClient from "./UsersClient";
import { requirePermission } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  await requirePermission("system.users.manage");
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <UsersClient currentUserId={user.id} />;
}

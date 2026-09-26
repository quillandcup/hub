import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import UsersClient from "./UsersClient";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  await requireAdminPage();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <UsersClient currentUserId={user.id} />;
}

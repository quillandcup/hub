import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import UsersClient from "./UsersClient";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <UsersClient currentUserId={user.id} />;
}

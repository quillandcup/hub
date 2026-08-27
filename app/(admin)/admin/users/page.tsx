import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UsersClient from "./UsersClient";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <UsersClient currentUserId={user.id} />;
}

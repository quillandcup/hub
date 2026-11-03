import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import PreviewsClient from "./PreviewsClient";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Previews",
};

export default async function PreviewsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  // Only what the picker shows goes to the client component.
  const members = (await createRepos(supabase).members.list({ orderBy: "name" })).map(({ id, name, displayName, email }) => ({ id, name, displayName, email }));
  return <PreviewsClient allMembers={members} />;
}

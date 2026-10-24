import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import SegmentsClient from "./SegmentsClient";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Segments",
};

export default async function SegmentsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  // Only what the picker shows goes to the client component.
  const members = (await createRepos(supabase).members.list({ orderBy: "name" })).map(({ id, name, email }) => ({ id, name, email }));
  return <SegmentsClient allMembers={members} />;
}

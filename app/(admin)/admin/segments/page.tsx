import type { Metadata } from "next";
import SegmentsClient from "./SegmentsClient";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const metadata: Metadata = {
  title: "Segments",
};

export default async function SegmentsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const members = await fetchAllRows<{ id: string; name: string; email: string }>((from, to) =>
    supabase.from("members").select("id, name, email").order("name").range(from, to)
  );
  return <SegmentsClient allMembers={members} />;
}

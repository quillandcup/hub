import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import HostsClient from "./HostsClient";
import { requireAdminPage } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";

export const metadata: Metadata = {
  title: "Hosts",
};

export default async function HostsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const prickleTypes = await createRepos(supabase).prickles.typesRequiringHost();

  return <HostsClient prickleTypes={prickleTypes} />;
}

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import HostsClient from "./HostsClient";
import { requirePermission } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";

export const metadata: Metadata = {
  title: "Hosts",
};

export default async function HostsPage() {
  await requirePermission("prickles.manage");
  const supabase = await createClient();
  const prickleTypes = await createRepos(supabase).prickles.typesRequiringHost();

  return <HostsClient prickleTypes={prickleTypes} />;
}

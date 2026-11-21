import type { Metadata } from "next";
import MissingHostsClient from "./MissingHostsClient";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { loadMissingHosts } from "@/lib/missing-hosts";

export const metadata: Metadata = {
  title: "Prickles Missing Hosts",
};

export default async function MissingHostsPage() {
  await requireAdminPage();
  const data = await loadMissingHosts(createRepos(await createClient()));
  return <MissingHostsClient {...data} />;
}

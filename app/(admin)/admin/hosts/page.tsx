import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import HostsClient from "./HostsClient";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Hosts",
};

export default async function HostsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const { data: prickleTypes } = await supabase
    .from("prickle_types")
    .select("id, name")
    .eq("requires_host", true)
    .order("name");

  return <HostsClient prickleTypes={prickleTypes ?? []} />;
}

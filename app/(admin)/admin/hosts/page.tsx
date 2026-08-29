import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import HostsClient from "./HostsClient";

export const metadata: Metadata = {
  title: "Hosts",
};

export default async function HostsPage() {
  const supabase = await createClient();
  const { data: prickleTypes } = await supabase
    .from("prickle_types")
    .select("id, name")
    .eq("requires_host", true)
    .order("name");

  return <HostsClient prickleTypes={prickleTypes ?? []} />;
}

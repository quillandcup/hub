import type { Metadata } from "next";
import MissingHostsClient from "./MissingHostsClient";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Prickles Missing Hosts",
};

export default async function MissingHostsPage() {
  await requireAdminPage();
  return <MissingHostsClient />;
}

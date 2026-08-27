import type { Metadata } from "next";
import MissingHostsClient from "./MissingHostsClient";

export const metadata: Metadata = {
  title: "Prickles Missing Hosts",
};

export default function MissingHostsPage() {
  return <MissingHostsClient />;
}

import type { Metadata } from "next";
import { redirectLegacyTabParam } from "@/lib/tab-routes";
import MyPricklesPage, { MY_PRICKLES_TAB_IDS, MY_PRICKLES_TITLE } from "./MyPricklesPage";

export const metadata: Metadata = { title: MY_PRICKLES_TITLE };

/**
 * My Prickles, Upcoming tab. Legacy ?tab=<id> links redirect to /my-prickles/<id>; the older
 * ?tab=commitments&slot=<seriesKey> (commit to a slot) now opens All Prickles in commit mode.
 */
export default async function MyPricklesIndex({ searchParams }: PageProps<"/my-prickles">) {
  redirectLegacyTabParam("/my-prickles", MY_PRICKLES_TAB_IDS, await searchParams, (target) => {
    const slot = target.params.get("slot");
    target.params.delete("slot");
    if (target.tab === "commitments" && slot) {
      target.tab = "all";
      target.params.set("commit", slot);
    }
  });
  return <MyPricklesPage tab="upcoming" />;
}

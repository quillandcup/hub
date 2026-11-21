import type { Metadata } from "next";
import { tabTitle } from "@/lib/tab-routes";
import MyPricklesPage, { MY_PRICKLES_TITLE, MY_PRICKLES_TAB_LABELS } from "../MyPricklesPage";

export const metadata: Metadata = { title: tabTitle({ section: MY_PRICKLES_TITLE }, MY_PRICKLES_TAB_LABELS.all, false) };

/** ?commit=<seriesKey>[,...] opens commit mode with those slots picked (empty: nothing picked). */
export default async function AllPricklesPage({ searchParams }: PageProps<"/my-prickles/all">) {
  const { commit } = await searchParams;
  return <MyPricklesPage tab="all" commit={Array.isArray(commit) ? commit.join(",") : commit} />;
}

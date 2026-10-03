import type { Metadata } from "next";
import { tabTitle } from "@/lib/tab-routes";
import MyPricklesPage, { MY_PRICKLES_TITLE, MY_PRICKLES_TAB_LABELS } from "../MyPricklesPage";

export const metadata: Metadata = { title: tabTitle({ section: MY_PRICKLES_TITLE }, MY_PRICKLES_TAB_LABELS.history, false) };

export default function AttendanceHistoryPage() {
  return <MyPricklesPage tab="history" />;
}

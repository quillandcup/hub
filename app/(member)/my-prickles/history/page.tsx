import type { Metadata } from "next";
import { tabTitle } from "@/lib/tab-routes";
import { parseCheckinPrefill } from "@/lib/prickle-checkins";
import MyPricklesPage, { MY_PRICKLES_TITLE, MY_PRICKLES_TAB_LABELS } from "../MyPricklesPage";

export const metadata: Metadata = { title: tabTitle({ section: MY_PRICKLES_TITLE }, MY_PRICKLES_TAB_LABELS.history, false) };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Attendance History. ?checkin=<prickle id> or ?checkout=<prickle id> opens that prickle's
 * check-in / check-out modal (the links in Slack DMs, notifications and the prickle page);
 * ?feel= and ?need= carry "coming in" answers from Find a Prickle to pre-fill the check-in.
 */
export default async function AttendanceHistoryPage({ searchParams }: PageProps<"/my-prickles/history">) {
  const params = await searchParams;
  const checkin = first(params.checkin);
  const checkout = first(params.checkout);
  const check = checkin
    ? { prickleId: checkin, half: "checkin" as const, prefill: parseCheckinPrefill(params) }
    : checkout
      ? { prickleId: checkout, half: "checkout" as const, prefill: null }
      : undefined;
  return <MyPricklesPage tab="history" check={check} />;
}

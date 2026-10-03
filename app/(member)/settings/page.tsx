import type { Metadata } from "next";
import { redirectLegacyTabParam } from "@/lib/tab-routes";
import SettingsPage, { SETTINGS_TAB_IDS, SETTINGS_TITLE } from "./SettingsPage";

export const metadata: Metadata = { title: SETTINGS_TITLE };

/** Settings, Account tab. Legacy /settings?tab=<id> links (e.g. in Slack DMs already sent) redirect to /settings/<id>. */
export default async function SettingsIndex({ searchParams }: PageProps<"/settings">) {
  redirectLegacyTabParam("/settings", SETTINGS_TAB_IDS, await searchParams);
  return <SettingsPage tab="account" />;
}

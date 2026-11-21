import type { Metadata } from "next";
import { tabTitle } from "@/lib/tab-routes";
import SettingsPage, { SETTINGS_TITLE, SETTINGS_TAB_LABELS } from "../SettingsPage";

export const metadata: Metadata = { title: tabTitle({ section: SETTINGS_TITLE }, SETTINGS_TAB_LABELS.profile, false) };

export default function ProfileSettingsPage() {
  return <SettingsPage tab="profile" />;
}

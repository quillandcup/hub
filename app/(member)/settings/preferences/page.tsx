import type { Metadata } from "next";
import { tabTitle } from "@/lib/tab-routes";
import SettingsPage, { SETTINGS_TITLE, SETTINGS_TAB_LABELS } from "../SettingsPage";

export const metadata: Metadata = { title: tabTitle({ section: SETTINGS_TITLE }, SETTINGS_TAB_LABELS.preferences, false) };

export default function PreferencesSettingsPage() {
  return <SettingsPage tab="preferences" />;
}

/** Plain module (no component imports) so lib/site-pages.ts can read the tabs. */
export const SETTINGS_TAB_IDS = ["account", "profile", "identity", "preferences", "notifications", "hosting", "previews"] as const;
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];
export const SETTINGS_TITLE = "Settings";
export const SETTINGS_TAB_LABELS: Record<SettingsTabId, string> = {
  account: "Account",
  profile: "Profile",
  identity: "Identity",
  preferences: "Preferences",
  notifications: "Notifications",
  hosting: "Hosting",
  previews: "Previews",
};

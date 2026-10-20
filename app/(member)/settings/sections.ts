import type { SettingsTabId } from "./tabs";

/**
 * The parts of each settings tab worth finding by name, for universal search: a row per entry,
 * linking to `/settings/<tab>#<id>`. `id` is the DOM id of the heading or field in that tab's
 * panel. Notification kinds aren't listed: lib/site-pages.ts makes a row per kind from the
 * notification registry (each list item is `#notification-<kind id>`).
 * tests/lib/site-pages.test.ts fails if an id here is gone from the panels, or a panel gains a
 * section heading that isn't listed (or marked as the tab's own heading there).
 */
export interface SettingsSection {
  tab: SettingsTabId;
  id: string;
  title: string;
  keywords?: string[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { tab: "account", id: "account-information", title: "Account information", keywords: ["email", "address"] },
  { tab: "account", id: "slack-connect-heading", title: "Slack", keywords: ["connect", "sign in", "link"] },
  { tab: "account", id: "active-sessions", title: "Active sessions", keywords: ["sign out", "logout", "devices", "revoke", "browsers"] },

  { tab: "profile", id: "profile-bio", title: "Bio", keywords: ["about", "about me", "introduce"] },
  { tab: "profile", id: "profile-ask-me-about", title: "Ask me about", keywords: ["topics", "interests"] },
  { tab: "profile", id: "profile-instagram", title: "Instagram", keywords: ["social", "link"] },
  { tab: "profile", id: "profile-facebook", title: "Facebook", keywords: ["social", "link"] },
  { tab: "profile", id: "profile-x", title: "X (Twitter)", keywords: ["twitter", "social", "link"] },
  { tab: "profile", id: "profile-whos-coming", title: "Who's coming", keywords: ["roster", "privacy", "hide", "list", "calendar", "committed"] },

  { tab: "identity", id: "identity-real-name", title: "Real name", keywords: ["name", "legal"] },
  { tab: "identity", id: "identity-display-name", title: "Display name", keywords: ["name", "pen name", "shown"] },
  { tab: "identity", id: "identity-birthday", title: "Birthday", keywords: ["birth", "date", "hedgie birthday"] },
  { tab: "identity", id: "identity-pen-names", title: "Pen names and Zoom/Slack names", keywords: ["pen name", "alias", "aliases", "zoom name", "slack name", "display name", "other names"] },
  { tab: "identity", id: "identity-email-aliases", title: "Email aliases", keywords: ["email", "other email addresses", "old email", "kajabi"] },

  { tab: "preferences", id: "theme", title: "Theme", keywords: ["dark mode", "light mode", "appearance", "color"] },
  { tab: "preferences", id: "timezone", title: "Time zone", keywords: ["timezone", "clock", "local time"] },

  { tab: "notifications", id: "browser-notifications", title: "Browser notifications", keywords: ["push", "devices", "test notification"] },

  { tab: "hosting", id: "prickle-vibe", title: "My Prickle vibe", keywords: ["host", "hosting", "what to expect", "prickle picker"] },
];

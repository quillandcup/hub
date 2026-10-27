import type { FeatureKey } from "@/lib/features";
import { SETTINGS_TAB_IDS, SETTINGS_TAB_LABELS, SETTINGS_TITLE } from "@/app/(member)/settings/tabs";
import { MY_PRICKLES_TAB_IDS, MY_PRICKLES_TAB_LABELS, MY_PRICKLES_TITLE } from "@/app/(member)/my-prickles/tabs";
import { SETTINGS_SECTIONS } from "@/app/(member)/settings/sections";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";
import { MY_WRITING_TAB_IDS, MY_WRITING_TAB_LABELS, MY_WRITING_TITLE } from "@/app/(member)/projects/tabs";

/**
 * Every page a person can navigate to, in one place. The sidebars render the entries that have a
 * `nav` slot; universal search ("Pages") finds all of them. A page that isn't worth a sidebar link
 * (a data-hygiene tool reached from the health check, a settings tab) simply has no `nav`.
 * tests/lib/site-pages.test.ts fails when a static page route is missing here, so adding a page
 * means deciding it: list it, or exclude it there with a reason. Tab pages come from the tab
 * modules next to each tabbed page (`tabs.ts`), so a new tab shows up by itself.
 */
export interface SitePage {
  title: string;
  href: string;
  audience: "member" | "admin";
  /** Where it lives, shown under the title in search; for a sidebar page, its sidebar group. */
  section: string;
  /** Present when the sidebar links to it. */
  nav?: {
    icon: string;
    /** Path prefixes besides `href` that keep it highlighted (a prickle's page keeps My Prickles lit). */
    activeFor?: string[];
  };
  /** Extra words that find it in search ("logout" finds Account). */
  keywords?: string[];
  /** A page of the member app that only admins get (Settings → Previews). */
  staffOnly?: boolean;
  /** Only shown (sidebar and search) when this feature is on for the viewer. */
  feature?: FeatureKey;
}

export const MEMBER_NAV_GROUPS = ["Home", "My Burrow", "Community", "Explore"] as const;
export const ADMIN_NAV_GROUPS: { name: string; /** Rarely-used maintenance tooling, folded by default. */ collapsible?: boolean }[] = [
  { name: "Overview" },
  { name: "Member Programs" },
  { name: "Sales & Marketing" },
  { name: "Education" },
  { name: "Accountability" },
  { name: "Community" },
  { name: "Analytics", collapsible: true },
  { name: "System", collapsible: true },
  { name: "Developer", collapsible: true },
];

/** Every tab of a tabbed page; the first lives at the base path, shared with the page's sidebar entry (if any). */
function tabPages<Id extends string>(
  base: string,
  section: string,
  ids: readonly Id[],
  labels: Record<Id, string>,
  opts: { keywords?: Partial<Record<Id, string[]>> } = {}
): SitePage[] {
  return ids.map((id, i) => ({
    title: labels[id],
    href: i === 0 ? base : `${base}/${id}`,
    audience: "member" as const,
    section,
    keywords: opts.keywords?.[id],
  }));
}

/** A part of a settings tab (a heading or field), linking to its anchor: the sections list plus a row per notification kind. */
function settingsSections(): SitePage[] {
  const tabHref = (tab: (typeof SETTINGS_TAB_IDS)[number]) => (tab === SETTINGS_TAB_IDS[0] ? "/settings" : `/settings/${tab}`);
  const section = (tab: (typeof SETTINGS_TAB_IDS)[number]) => `${SETTINGS_TITLE} · ${SETTINGS_TAB_LABELS[tab]}`;
  return [
    ...SETTINGS_SECTIONS.map((s) => ({ title: s.title, href: `${tabHref(s.tab)}#${s.id}`, audience: "member" as const, section: section(s.tab), keywords: s.keywords })),
    ...NOTIFICATION_KINDS.map((k) => ({
      title: k.label,
      href: `${tabHref("notifications")}#notification-${k.id}`,
      audience: "member" as const,
      section: section("notifications"),
      keywords: [k.category, "notification", "reminder"],
      ...("feature" in k ? { feature: k.feature } : {}),
    })),
  ];
}

const member = (page: Omit<SitePage, "audience">): SitePage => ({ ...page, audience: "member" });
const admin = (page: Omit<SitePage, "audience">): SitePage => ({ ...page, audience: "admin" });

export const SITE_PAGES: SitePage[] = [
  // Member sidebar
  member({ title: "Dashboard", href: "/dashboard", section: "Home", nav: { icon: "🏠" }, keywords: ["home"] }),
  member({ title: "Writing", href: "/projects", section: "My Burrow", nav: { icon: "📝", activeFor: ["/projects/"] }, keywords: ["my writing", "wip"] }),
  member({ title: "Prickles", href: "/my-prickles", section: "My Burrow", nav: { icon: "🦔", activeFor: ["/prickles/"] }, keywords: ["my prickles", "sessions"] }),
  member({ title: "Courses", href: "/courses", section: "My Burrow", nav: { icon: "🎓", activeFor: ["/courses/"] }, keywords: ["ready writer", "lessons", "learn", "video"], feature: "courses" }),
  member({ title: "Streaks", href: "/streaks", section: "My Burrow", nav: { icon: "🔥" } }),
  member({ title: "Members", href: "/members", section: "Explore", nav: { icon: "👥" }, keywords: ["directory", "people"] }),
  member({ title: "Big Sisters", href: "/big-sisters", section: "Community", nav: { icon: "👭" }, keywords: ["mentor", "mentorship", "new member", "buddy"], feature: "big_sisters" }),
  member({ title: "Chat", href: "/chat", section: "Community", nav: { icon: "💬" }, keywords: ["messages", "slack", "dm"], feature: "chat" }),
  member({ title: "Wheel of Wonder", href: "/wheel-of-wonder", section: "Community", nav: { icon: "🎡" }, keywords: ["spin", "prompt"] }),
  member({ title: "Book Shelf", href: "/bookshelf", section: "Explore", nav: { icon: "🐚" }, keywords: ["bookshelf", "library", "books"] }),
  member({ title: "Events", href: "/events", section: "Explore", nav: { icon: "📸" }, keywords: ["retreat", "meetup"], feature: "events" }),

  // Member pages the sidebar doesn't link (Hedgie Help is the question mark in the top bar)
  member({ title: "Notifications", href: "/notifications", section: "Inbox", keywords: ["inbox", "bell", "alerts"] }),
  member({ title: "Hedgie Help", href: "/help", section: "Help", keywords: ["how to", "guide", "support", "docs"] }),
  member({ title: "Privacy", href: "/privacy", section: "Help", keywords: ["data", "policy", "who can see"], feature: "message_privacy" }),

  // Tabs
  ...tabPages("/projects", MY_WRITING_TITLE, MY_WRITING_TAB_IDS, MY_WRITING_TAB_LABELS, {
    keywords: { books: ["publish", "published"], awards: ["wins", "prizes"] },
  }),
  ...tabPages("/my-prickles", MY_PRICKLES_TITLE, MY_PRICKLES_TAB_IDS, MY_PRICKLES_TAB_LABELS, {
    keywords: { all: ["calendar", "schedule"], find: ["picker", "join", "sign up"], commitments: ["recurring", "weekly", "slot"], hosting: ["host"], history: ["attended", "past"] },
  }),
  ...tabPages("/settings", SETTINGS_TITLE, SETTINGS_TAB_IDS, SETTINGS_TAB_LABELS, {
    keywords: {
      account: ["email", "sessions", "devices", "sign out", "logout", "slack connect", "slack"],
      profile: ["public profile", "bio", "about me", "ask me about", "topics", "interests", "social", "links", "instagram", "facebook", "twitter", "x"],
      identity: ["real name", "name", "pen name", "pen names", "alias", "aliases", "zoom name", "slack name", "birthday", "email", "email alias", "other email addresses"],
      preferences: ["theme", "dark mode", "light mode", "appearance", "timezone", "time zone"],
      notifications: ["email", "push", "browser notifications", "slack", "devices", "reminders", "opt out", "unsubscribe"],
      hosting: ["host", "prickle vibe", "vibe"],
      previews: ["beta", "labs", "experiments", "feature flags"],
    },
  }).map((page) => (page.href === "/settings/previews" ? { ...page, staffOnly: true } : page)),
  ...settingsSections(),

  // Admin sidebar
  admin({ title: "Dashboard", href: "/admin", section: "Overview", nav: { icon: "📊" } }),
  admin({ title: "Calendar View", href: "/admin/calendar", section: "Overview", nav: { icon: "📅" } }),
  admin({ title: "Work Queue", href: "/admin/work-queue", section: "Overview", nav: { icon: "✅" }, feature: "work_queue" }),
  admin({ title: "All Members", href: "/admin/members", section: "Community", nav: { icon: "👥" }, keywords: ["people"] }),
  admin({ title: "Outreach", href: "/admin/outreach", section: "Sales & Marketing", nav: { icon: "🎯" }, keywords: ["queue", "touches"] }),
  admin({ title: "Big Sisters", href: "/admin/mentorship", section: "Member Programs", nav: { icon: "👭" }, keywords: ["mentor", "mentorship", "trial", "onboarding", "conversion"], feature: "big_sisters" }),
  admin({ title: "Big Sister Volunteers", href: "/admin/mentorship/volunteers", section: "Member Programs", keywords: ["mentor", "available", "pool", "opt in"], feature: "big_sisters" }),
  admin({ title: "Big Sister Effectiveness", href: "/admin/mentorship/big-sisters", section: "Member Programs", keywords: ["mentor", "conversion", "trial", "trend", "quarter"], feature: "big_sisters" }),
  admin({ title: "Hedgieversaries", href: "/admin/hedgieversaries", section: "Member Programs", nav: { icon: "🎂" }, keywords: ["anniversary", "birthday"], feature: "hedgieversaries" }),
  admin({ title: "At-Risk Members", href: "/admin/at-risk", section: "Member Programs", nav: { icon: "⚠️" }, keywords: ["churn", "lapsing"] }),
  admin({ title: "Courses", href: "/admin/courses", section: "Education", nav: { icon: "📚", activeFor: ["/admin/courses/"] }, keywords: ["lessons", "kajabi", "ready writer", "publish", "launch"], feature: "courses" }),
  admin({ title: "Programs", href: "/admin/programs", section: "Education", nav: { icon: "🎓" }, keywords: ["cohorts"], feature: "program_cohorts" }),
  admin({ title: "Network", href: "/admin/members/network", section: "Community", nav: { icon: "🕸️" }, keywords: ["graph"] }),
  admin({ title: "Badges", href: "/admin/badges", section: "Community", nav: { icon: "🏅" } }),
  admin({ title: "Hosts", href: "/admin/hosts", section: "Accountability", nav: { icon: "🎙️" } }),
  admin({ title: "Events", href: "/admin/events", section: "Community", nav: { icon: "📸" }, feature: "events" }),
  admin({ title: "Calendar items", href: "/admin/events/calendar", section: "Community", feature: "events", keywords: ["google calendar", "show in events"] }),
  admin({ title: "Community Stats", href: "/admin/stats", section: "Analytics", nav: { icon: "✨" } }),
  admin({ title: "Prickle Insights", href: "/admin/insights/prickles", section: "Accountability", nav: { icon: "✍️" } }),
  admin({ title: "Slack Engagement", href: "/admin/insights/slack-engagement", section: "Analytics", nav: { icon: "💬" } }),
  admin({ title: "Resubscriptions", href: "/admin/insights/resubscriptions", section: "Analytics", nav: { icon: "🔄" } }),
  admin({ title: "Wheel of Wonder", href: "/admin/wheel-of-wonder", section: "Analytics", nav: { icon: "🎡" } }),
  admin({ title: "Feature Usage", href: "/admin/analytics", section: "Analytics", nav: { icon: "📈" }, keywords: ["events", "funnel", "clicks"] }),
  admin({ title: "Explore Usage", href: "/admin/analytics/explore", section: "Analytics", keywords: ["funnel builder", "breakdown", "events"] }),
  admin({ title: "Import Data", href: "/admin/data/import", section: "Developer", nav: { icon: "📥" }, keywords: ["sync", "kajabi", "zoom"] }),
  admin({ title: "Health Check", href: "/admin/hygiene", section: "System", nav: { icon: "🏥" }, keywords: ["hygiene", "data quality"] }),
  admin({ title: "Users", href: "/admin/users", section: "System", nav: { icon: "🔑" }, keywords: ["invite", "roles"] }),
  admin({ title: "Activity Log", href: "/admin/activity", section: "System", nav: { icon: "📜" }, keywords: ["audit"] }),
  admin({ title: "Slack Channels", href: "/admin/data/slack-channels", section: "System", nav: { icon: "🔒" }, keywords: ["restricted", "privacy"] }),
  admin({ title: "Prickle Types", href: "/admin/data/prickle-types", section: "System", nav: { icon: "🏷️" } }),
  admin({ title: "Member Overrides", href: "/admin/member-overrides", section: "System", nav: { icon: "🎁" }, feature: "member_overrides" }),
  admin({ title: "Prickle Zoom Link", href: "/admin/prickle-join", section: "Accountability", nav: { icon: "🔗" }, keywords: ["zoom", "passcode", "password", "join link", "room"] }),
  admin({ title: "Segments", href: "/admin/segments", section: "Developer", nav: { icon: "🧩" } }),
  admin({ title: "Feedback", href: "/admin/feedback", section: "Developer", nav: { icon: "💬" } }),
  admin({ title: "Test Notifications", href: "/admin/notifications", section: "Developer", nav: { icon: "🔔" }, keywords: ["send test", "slack", "email", "push", "in-app", "reminders"] }),

  // Admin pages reached by drilling in (mostly from the health check), not from the sidebar
  admin({ title: "Unmatched Calendar Events", href: "/admin/hygiene/unmatched-events", section: "System" }),
  admin({ title: "Prickles Missing Hosts", href: "/admin/data-health/missing-hosts", section: "System" }),
  admin({ title: "Chat Gap-fills", href: "/admin/data-health/gap-fills", section: "System", keywords: ["slack", "webhook", "missed events", "catch-up"] }),
  admin({ title: "Unmatched Zoom Names", href: "/admin/hygiene/unmatched-zoom", section: "System" }),
  admin({ title: "Ambiguous Zoom Names", href: "/admin/hygiene/ambiguous-names", section: "System" }),
  admin({ title: "Unmatched Slack Users", href: "/admin/hygiene/unmatched-slack", section: "System" }),
  admin({ title: "Members Without Slack", href: "/admin/hygiene/members-without-slack", section: "System" }),
  admin({ title: "Merge & Fix", href: "/admin/hygiene/merge-fix", section: "System", keywords: ["duplicates", "merge"] }),
  admin({ title: "External Conflicts", href: "/admin/hygiene/external-conflicts", section: "System" }),
  admin({ title: "Missing Member Data", href: "/admin/hygiene/missing-member-data", section: "System" }),
  admin({ title: "Name Matching Game", href: "/admin/hygiene/name-matching", section: "System" }),
  admin({ title: "Name Aliases", href: "/admin/data/aliases", section: "System" }),
];

/** True when the page's feature (if any) is on. */
export const pageEnabled = (page: SitePage, features: readonly FeatureKey[]) => !page.feature || features.includes(page.feature);

/** The sidebar's groups for one audience, each with its visible links in registry order. */
export function navGroups(audience: "member" | "admin", features: readonly FeatureKey[]) {
  const groups = audience === "member" ? MEMBER_NAV_GROUPS.map((name) => ({ name, collapsible: false })) : ADMIN_NAV_GROUPS.map((g) => ({ name: g.name, collapsible: !!g.collapsible }));
  return groups
    .map((g) => ({ ...g, items: SITE_PAGES.filter((p) => p.audience === audience && p.nav && p.section === g.name && pageEnabled(p, features)) }))
    .filter((g) => g.items.length > 0);
}

import type { FeatureKey } from "@/lib/features";
import { SETTINGS_TAB_IDS, SETTINGS_TAB_LABELS, SETTINGS_TITLE } from "@/app/(member)/settings/tabs";
import { MY_PRICKLES_TAB_IDS, MY_PRICKLES_TAB_LABELS, MY_PRICKLES_TITLE } from "@/app/(member)/my-prickles/tabs";
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
  /** Only shown (sidebar and search) when this feature is on for the viewer. */
  feature?: FeatureKey;
}

export const MEMBER_NAV_GROUPS = ["Home", "My Burrow", "Community"] as const;
export const ADMIN_NAV_GROUPS: { name: string; /** Rarely-used maintenance tooling, folded by default. */ collapsible?: boolean }[] = [
  { name: "Overview" },
  { name: "Members" },
  { name: "Community" },
  { name: "Data Health" },
  { name: "Analytics" },
  { name: "System", collapsible: true },
];

/** The tabs of a tabbed page after the first (the first lives at the base path, which has its own entry or none). */
function tabPages<Id extends string>(
  base: string,
  section: string,
  ids: readonly Id[],
  labels: Record<Id, string>,
  opts: { includeFirst?: boolean; keywords?: Partial<Record<Id, string[]>> } = {}
): SitePage[] {
  return ids
    .filter((_, i) => i > 0 || opts.includeFirst)
    .map((id, i) => ({
      title: labels[id],
      href: i === 0 && opts.includeFirst ? base : `${base}/${id}`,
      audience: "member" as const,
      section,
      keywords: opts.keywords?.[id],
    }));
}

const member = (page: Omit<SitePage, "audience">): SitePage => ({ ...page, audience: "member" });
const admin = (page: Omit<SitePage, "audience">): SitePage => ({ ...page, audience: "admin" });

export const SITE_PAGES: SitePage[] = [
  // Member sidebar
  member({ title: "Dashboard", href: "/dashboard", section: "Home", nav: { icon: "🏠" }, keywords: ["home"] }),
  member({ title: "My Writing", href: "/projects", section: "My Burrow", nav: { icon: "📝", activeFor: ["/projects/"] }, keywords: ["projects", "wip"] }),
  member({ title: "My Prickles", href: "/my-prickles", section: "My Burrow", nav: { icon: "🦔", activeFor: ["/prickles/"] }, keywords: ["upcoming", "sessions"] }),
  member({ title: "Streaks", href: "/streaks", section: "My Burrow", nav: { icon: "🔥" } }),
  member({ title: "Members", href: "/members", section: "Community", nav: { icon: "👭" }, keywords: ["directory", "people"] }),
  member({ title: "Chat", href: "/chat", section: "Community", nav: { icon: "💬" }, keywords: ["messages", "slack", "dm"], feature: "chat" }),
  member({ title: "Wheel of Wonder", href: "/wheel-of-wonder", section: "Community", nav: { icon: "🎡" }, keywords: ["spin", "prompt"] }),
  member({ title: "Bookshelf", href: "/bookshelf", section: "Community", nav: { icon: "🐚" }, keywords: ["library", "books"] }),
  member({ title: "Events", href: "/events", section: "Community", nav: { icon: "📸" }, keywords: ["retreat", "meetup"], feature: "events" }),

  // Member pages the sidebar doesn't link
  member({ title: "Network", href: "/network", section: "Community", keywords: ["graph", "connections"] }),
  member({ title: "Notifications", href: "/notifications", section: "Inbox", keywords: ["inbox", "bell", "alerts"] }),
  member({ title: "Privacy", href: "/privacy", section: "Help", keywords: ["data", "policy", "who can see"] }),

  // Tabs
  ...tabPages("/projects", MY_WRITING_TITLE, MY_WRITING_TAB_IDS, MY_WRITING_TAB_LABELS, {
    keywords: { books: ["publish", "published"], awards: ["wins", "prizes"] },
  }),
  ...tabPages("/my-prickles", MY_PRICKLES_TITLE, MY_PRICKLES_TAB_IDS, MY_PRICKLES_TAB_LABELS, {
    keywords: { all: ["calendar", "schedule"], find: ["picker", "join", "sign up"], commitments: ["recurring", "weekly", "slot"], hosting: ["host"], history: ["attended", "past"] },
  }),
  ...tabPages("/settings", SETTINGS_TITLE, SETTINGS_TAB_IDS, SETTINGS_TAB_LABELS, {
    includeFirst: true,
    keywords: {
      account: ["email", "sessions", "sign out", "logout", "slack connect"],
      profile: ["bio", "photo", "ask me about"],
      identity: ["name", "pronouns", "display name", "birthday"],
      preferences: ["theme", "dark mode", "timezone"],
      notifications: ["email", "push", "slack", "reminders", "opt out", "unsubscribe"],
      hosting: ["host", "vibe"],
      previews: ["beta", "labs", "experiments"],
    },
  }),

  // Admin sidebar
  admin({ title: "Dashboard", href: "/admin", section: "Overview", nav: { icon: "📊" } }),
  admin({ title: "Calendar View", href: "/admin/calendar", section: "Overview", nav: { icon: "📅" } }),
  admin({ title: "Work Queue", href: "/admin/work-queue", section: "Members", nav: { icon: "✅" }, feature: "work_queue" }),
  admin({ title: "All Members", href: "/admin/members", section: "Members", nav: { icon: "👥" }, keywords: ["people"] }),
  admin({ title: "At-Risk Members", href: "/admin/at-risk", section: "Members", nav: { icon: "⚠️" }, keywords: ["churn", "lapsing"] }),
  admin({ title: "Outreach", href: "/admin/outreach", section: "Members", nav: { icon: "🎯" }, keywords: ["queue", "touches"] }),
  admin({ title: "Hedgieversaries", href: "/admin/hedgieversaries", section: "Members", nav: { icon: "🎂" }, keywords: ["anniversary", "birthday"], feature: "hedgieversaries" }),
  admin({ title: "Member Overrides", href: "/admin/member-overrides", section: "Members", nav: { icon: "🎁" }, feature: "member_overrides" }),
  admin({ title: "Programs", href: "/admin/programs", section: "Members", nav: { icon: "🎓" }, keywords: ["cohorts"], feature: "program_cohorts" }),
  admin({ title: "Network", href: "/admin/members/network", section: "Community", nav: { icon: "🕸️" }, keywords: ["graph"] }),
  admin({ title: "Badges", href: "/admin/badges", section: "Community", nav: { icon: "🏅" } }),
  admin({ title: "Hosts", href: "/admin/hosts", section: "Community", nav: { icon: "🎙️" } }),
  admin({ title: "Events", href: "/admin/events", section: "Community", nav: { icon: "📸" }, feature: "events" }),
  admin({ title: "Health Check", href: "/admin/hygiene", section: "Data Health", nav: { icon: "🏥" }, keywords: ["hygiene", "data quality"] }),
  admin({ title: "Reconciliation", href: "/admin/hygiene#reconciliation", section: "Data Health", nav: { icon: "🔄" }, keywords: ["subscriptions"] }),
  admin({ title: "Community Stats", href: "/admin/stats", section: "Analytics", nav: { icon: "✨" } }),
  admin({ title: "Prickle Insights", href: "/admin/insights/prickles", section: "Analytics", nav: { icon: "✍️" } }),
  admin({ title: "Slack Engagement", href: "/admin/insights/slack-engagement", section: "Analytics", nav: { icon: "💬" } }),
  admin({ title: "Resubscriptions", href: "/admin/insights/resubscriptions", section: "Analytics", nav: { icon: "🔄" } }),
  admin({ title: "Wheel of Wonder", href: "/admin/wheel-of-wonder", section: "Analytics", nav: { icon: "🎡" } }),
  admin({ title: "Import Data", href: "/admin/data/import", section: "System", nav: { icon: "📥" }, keywords: ["sync", "kajabi", "zoom"] }),
  admin({ title: "Prickle Types", href: "/admin/data/prickle-types", section: "System", nav: { icon: "🏷️" } }),
  admin({ title: "Slack Channels", href: "/admin/data/slack-channels", section: "System", nav: { icon: "🔒" }, keywords: ["restricted", "privacy"] }),
  admin({ title: "Activity Log", href: "/admin/activity", section: "System", nav: { icon: "📜" }, keywords: ["audit"] }),
  admin({ title: "Users", href: "/admin/users", section: "System", nav: { icon: "🔑" }, keywords: ["invite", "roles"] }),
  admin({ title: "Segments", href: "/admin/segments", section: "System", nav: { icon: "🧩" } }),
  admin({ title: "Feedback", href: "/admin/feedback", section: "System", nav: { icon: "💬" } }),

  // Admin pages reached by drilling in (mostly from the health check), not from the sidebar
  admin({ title: "Unmatched Calendar Events", href: "/admin/hygiene/unmatched-events", section: "Data Health" }),
  admin({ title: "Prickles Missing Hosts", href: "/admin/data-health/missing-hosts", section: "Data Health" }),
  admin({ title: "Unmatched Zoom Names", href: "/admin/hygiene/unmatched-zoom", section: "Data Health" }),
  admin({ title: "Ambiguous Zoom Names", href: "/admin/hygiene/ambiguous-names", section: "Data Health" }),
  admin({ title: "Unmatched Slack Users", href: "/admin/hygiene/unmatched-slack", section: "Data Health" }),
  admin({ title: "Members Without Slack", href: "/admin/hygiene/members-without-slack", section: "Data Health" }),
  admin({ title: "Merge & Fix", href: "/admin/hygiene/merge-fix", section: "Data Health", keywords: ["duplicates", "merge"] }),
  admin({ title: "External Conflicts", href: "/admin/hygiene/external-conflicts", section: "Data Health" }),
  admin({ title: "Missing Member Data", href: "/admin/hygiene/missing-member-data", section: "Data Health" }),
  admin({ title: "Name Matching Game", href: "/admin/hygiene/name-matching", section: "Data Health" }),
  admin({ title: "Name Aliases", href: "/admin/data/aliases", section: "Data Health" }),
  admin({ title: "PRD", href: "/admin/prd", section: "System", keywords: ["product requirements"] }),
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

/** Member detail tabs, at /admin/members/<id> (Overview) and /admin/members/<id>/<tab> (lib/tab-routes.ts). */
export const MEMBER_TAB_IDS = ["overview", "attendance", "slack", "identity"] as const;
export type MemberTabId = (typeof MEMBER_TAB_IDS)[number];
export const MEMBER_TAB_LABELS: Record<MemberTabId, string> = {
  overview: "Overview",
  attendance: "Attendance History",
  slack: "Slack Activity",
  identity: "Identity",
};

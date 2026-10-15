// Plain module (not "use client") so the server pages can import the ids.
export const MENTORSHIP_TABS = ["matches", "volunteers", "big-sisters"] as const;
export type MentorshipTab = (typeof MENTORSHIP_TABS)[number];

export const MENTORSHIP_BASE_PATH = "/admin/mentorship";
export const MENTORSHIP_TITLE = "Big Sisters";

export const MENTORSHIP_TAB_LABELS: Record<MentorshipTab, string> = {
  matches: "Matches",
  volunteers: "Volunteers",
  "big-sisters": "Effectiveness",
};

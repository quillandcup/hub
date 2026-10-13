/** Plain module (no component imports) so lib/site-pages.ts can read the tabs. */
export const MY_PRICKLES_TAB_IDS = ["upcoming", "all", "find", "commitments", "hosting", "history"] as const;
export type MyPricklesTabId = (typeof MY_PRICKLES_TAB_IDS)[number];
export const MY_PRICKLES_TITLE = "My Prickles";
export const MY_PRICKLES_TAB_LABELS: Record<MyPricklesTabId, string> = {
  upcoming: "Upcoming",
  all: "All Prickles",
  find: "Find a Prickle",
  commitments: "Commitments",
  hosting: "Hosting",
  history: "Attendance History",
};

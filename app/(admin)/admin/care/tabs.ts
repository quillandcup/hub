/** Plain module (no component imports) so lib/site-pages.ts and the routes can read the tabs. */
export const CARE_TAB_IDS = ["active", "earlier", "dms"] as const;
export type CareTabId = (typeof CARE_TAB_IDS)[number];
export const CARE_TITLE = "Hedgie Care";
export const CARE_TAB_LABELS: Record<CareTabId, string> = {
  active: "Active",
  earlier: "Earlier",
  dms: "Your DMs",
};

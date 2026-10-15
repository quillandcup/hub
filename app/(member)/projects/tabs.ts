/** Plain module (no component imports) so lib/site-pages.ts can read the tabs. */
export const MY_WRITING_TAB_IDS = ["projects", "books", "awards"] as const;
export type MyWritingTabId = (typeof MY_WRITING_TAB_IDS)[number];
export const MY_WRITING_TITLE = "My Writing";
export const MY_WRITING_TAB_LABELS: Record<MyWritingTabId, string> = {
  projects: "Projects",
  books: "Books",
  awards: "Awards",
};

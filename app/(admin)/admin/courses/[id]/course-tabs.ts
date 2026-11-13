/** The course page's tabs as paths (CLAUDE.md, "Tabs Are Paths"): Outline at /admin/courses/<id>, the others at /admin/courses/<id>/<tab>. Never `roster`, `stats` or `lessons`: those are sibling routes. */
export const COURSE_TAB_LABELS = { outline: "Outline", details: "Details", media: "Media" } as const;
export type CourseTab = keyof typeof COURSE_TAB_LABELS;

/** A course imported from Kajabi has videos and downloads to manage; one the Hub owns has no media tab until it does. */
export function courseTabIds(source: "kajabi" | "hub"): CourseTab[] {
  return source === "kajabi" ? ["outline", "details", "media"] : ["outline", "details"];
}

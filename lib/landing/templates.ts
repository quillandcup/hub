/**
 * Saved page-builder templates (docs/LANDING_PAGES.md, "Templates"): the limits and id checks the repository
 * (`lib/data/landing-templates.ts`), the actions and the editor share. Pure: no database, no React.
 */

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_DESCRIPTION_MAX = 500;
export const TEMPLATE_NOTE_MAX = 500;

/** How a version came to be: the first save, a better version saved over it, or an earlier one brought back. */
export type TemplateVersionKind = "created" | "overwritten" | "restored";

const BASE58 = "[1-9A-HJ-NP-Za-km-z]{12}";
/** Template and version ids are Tier 2 (never in a URL, docs/SHORT_IDS_PLAN.md): they travel only between our own client and server, and are checked at the door. */
export const isLandingTemplateId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^lpgt_${BASE58}$`).test(value);
export const isLandingTemplateVersionId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^lpgtv_${BASE58}$`).test(value);

/** What a name is compared by: trimmed and lower-cased, as the database's unique index does. */
export const templateNameKey = (name: string) => name.trim().toLowerCase();

/** The plain-words label of a version's kind, shown in History. */
export const TEMPLATE_KIND_LABELS: Record<TemplateVersionKind, string> = {
  created: "First saved",
  overwritten: "Saved over",
  restored: "Brought back",
};

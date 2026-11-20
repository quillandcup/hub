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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The blocks of a document by type with how many of each, nested ones included, most first: a preview of what a template holds without drawing it. */
export function blockTally(content: unknown): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!isObject(raw) || typeof raw.type !== "string" || !isObject(raw.props)) continue;
      counts.set(raw.type, (counts.get(raw.type) ?? 0) + 1);
      for (const value of Object.values(raw.props)) walk(value);
    }
  };
  walk(content);
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1));
}

/** "ImageText" becomes "Image text": a block type as a person would say it. */
export const blockTypeLabel = (type: string) => type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** The plain-words label of a version's kind, shown in History. */
export const TEMPLATE_KIND_LABELS: Record<TemplateVersionKind, string> = {
  created: "First saved",
  overwritten: "Saved over",
  restored: "Brought back",
};

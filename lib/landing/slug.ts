/** A landing page's address: lowercase words joined by dashes (/p/<slug>, and the editor at /admin/pages/<slug>). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** Addresses the admin routes use themselves (/admin/pages/new). */
export const RESERVED_SLUGS = ["new", "templates", "landing", "website", "design"];

export function isValidSlug(value: string | null | undefined): value is string {
  return Boolean(value && value.length <= SLUG_MAX && SLUG_PATTERN.test(value) && !RESERVED_SLUGS.includes(value));
}

/** "Spring Writing Challenge!" -> "spring-writing-challenge". May be empty when the title has no letters or digits. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

const BASE58 = "[1-9A-HJ-NP-Za-km-z]{12}";
/** Page and version ids are Tier 2 (never in a URL, docs/decisions/SHORT_IDS_PLAN.md): they travel only between our own client and server, and are checked at the door. */
export const isLandingPageId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^lpg_${BASE58}$`).test(value);
export const isLandingVersionId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^lpgv_${BASE58}$`).test(value);

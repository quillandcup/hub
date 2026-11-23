/**
 * A landing page's address: lowercase words joined by dashes. Published, it is served at /<slug> on the root host (`/p/<slug>` is the
 * route behind it, docs/product/LANDING_PAGES.md, "Addresses"), and the editor is at /admin/pages/<slug>.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** The page whose address is the root host's front page (`/`), not `/home` (admin: /admin/pages/home). */
export const HOME_SLUG = "home";

/**
 * Addresses a page may not take: the admin routes use some themselves (/admin/pages/new), and a page at the root host's
 * /<slug> must never shadow a real top-level path there. So the rest are every top-level path the root host serves or owns
 * (src/lib/root-routing.ts: the public pages, the Hub's signed-in paths, the platform's own), as far as a slug can spell
 * them. tests/lib/landing-reserved-slugs.test.ts fails when src/app or public/ gains a top-level path that is missing here.
 */
export const RESERVED_SLUGS = [
  // the editor's own addresses
  "new", "templates", "landing", "website", "design",
  // served on the root host
  "w", "p", "privacy", "security", "compliance",
  // the platform's
  "api", "monitoring",
  // the Hub's signed-in paths: (member), (admin) and the rest
  "big-sisters", "bookshelf", "changelog", "chat", "courses", "dashboard", "events", "help", "members",
  "my-prickles", "notifications", "prickles", "projects", "search", "settings", "streaks", "wheel-of-wonder", "writer-profile",
  "admin",
  "auth", "course-preview", "lesson-preview", "login", "mfa", "no-access", "unsubscribe", "verify-email",
];

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
export const isLandingSiteVersionId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^lpstv_${BASE58}$`).test(value);

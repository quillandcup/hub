import { safeHref } from "./data";

/**
 * The site template (docs/LANDING_PAGES.md, "Site template"): the header and footer every website page shares. Pure helpers,
 * safe in the browser and on the server. The stored JSON is untrusted (a row written by hand, an older shape), so every reader
 * goes through `normalizeSiteTemplate`, which keeps only known keys, clamps every choice to its list, caps every string and
 * cleans every link. Pictures are media library ids (`logoAssetId`), collected on publish like a page's.
 */

export const SITE_TEXT_MAX = 200;
export const SITE_LINKS_MAX = 12;
export const SITE_ITEMS_MAX = 8;

/** Where a header's items sit: all at the start, centred, or the logo at the start and the rest at the far end. */
export const HEADER_ALIGNMENTS = ["spread", "start", "center"] as const;
export type HeaderAlignment = (typeof HEADER_ALIGNMENTS)[number];

/** On a narrow header: the menu folds into a "Menu" disclosure, or its links just wrap. */
export const MOBILE_MENUS = ["fold", "wrap"] as const;
export type MobileMenu = (typeof MOBILE_MENUS)[number];

export const SOCIAL_NETWORKS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "pinterest", label: "Pinterest" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "substack", label: "Substack" },
  { value: "x", label: "X" },
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["value"];

export type SiteLink = { label: string; href: string };
export type SiteSocialLink = { network: SocialNetwork; href: string };

/** What each header-only block may be shown on: both sizes, only a wide header (`desktop`), or only a narrow one (`mobile`). */
export const ITEM_SHOWS = ["both", "desktop", "mobile"] as const;
export type ItemShow = (typeof ITEM_SHOWS)[number];

/** The sign-in link goes to the member app's sign-in page (a path on this site; the page itself is public). */
export const SIGN_IN_HREF = "/login";

export type HeaderItem =
  | { id: string; type: "logo"; show: ItemShow; logoAssetId: string; alt: string; href: string }
  | { id: string; type: "menu"; show: ItemShow; links: SiteLink[] }
  | { id: string; type: "cta"; show: ItemShow; label: string; href: string; look: "solid" | "outline" }
  | { id: string; type: "social"; show: ItemShow; links: SiteSocialLink[] }
  | { id: string; type: "signin"; show: ItemShow; label: string; look: "link" | "solid" | "outline" };
export type HeaderItemType = HeaderItem["type"];
export const HEADER_ITEM_TYPES: { value: HeaderItemType; label: string; hint: string }[] = [
  { value: "logo", label: "Logo", hint: "Your logo, linking to a page." },
  { value: "menu", label: "Menu", hint: "A row of links." },
  { value: "cta", label: "Call to action", hint: "One button, such as Join us." },
  { value: "social", label: "Social links", hint: "Links to your profiles." },
  { value: "signin", label: "Sign in", hint: "A link to the member sign-in page." },
];

export type SiteHeader = { show: boolean; align: HeaderAlignment; mobileMenu: MobileMenu; items: HeaderItem[] };
export type SiteFooter = { show: boolean; text: string; links: SiteLink[]; social: SiteSocialLink[] };
export type SiteTemplate = { header: SiteHeader; footer: SiteFooter };

export const EMPTY_SITE_TEMPLATE: SiteTemplate = {
  header: { show: false, align: "spread", mobileMenu: "fold", items: [] },
  footer: { show: false, text: "", links: [], social: [] },
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max = SITE_TEXT_MAX): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

function links(v: unknown): SiteLink[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, SITE_LINKS_MAX).map((l) => ({ label: text(obj(l).label, 80), href: safeHref(obj(l).href) }));
}

function social(v: unknown): SiteSocialLink[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, SITE_LINKS_MAX).map((l) => ({ network: oneOf(SOCIAL_NETWORKS.map((n) => n.value), obj(l).network, "instagram"), href: safeHref(obj(l).href) }));
}

let counter = 0;
/** A short key for an item, for React and for the editor's list; not an id of a row. */
export const newItemId = () => `item${Date.now().toString(36)}${(counter++).toString(36)}`;

function item(raw: unknown, index: number): HeaderItem | null {
  const o = obj(raw);
  const id = text(o.id, 40) || `item${index}`;
  const show = oneOf(ITEM_SHOWS, o.show, "both");
  switch (o.type) {
    case "logo":
      return { id, type: "logo", show, logoAssetId: text(o.logoAssetId, 80), alt: text(o.alt, 120), href: safeHref(o.href) };
    case "menu":
      return { id, type: "menu", show, links: links(o.links) };
    case "cta":
      return { id, type: "cta", show, label: text(o.label, 60), href: safeHref(o.href), look: oneOf(["solid", "outline"] as const, o.look, "solid") };
    case "social":
      return { id, type: "social", show, links: social(o.links) };
    case "signin":
      return { id, type: "signin", show, label: text(o.label, 60), look: oneOf(["link", "solid", "outline"] as const, o.look, "link") };
    default:
      return null;
  }
}

/** The site template as stored, whatever its shape: always a complete, clean document. */
export function normalizeSiteTemplate(value: unknown): SiteTemplate {
  const v = obj(value);
  const h = obj(v.header);
  const f = obj(v.footer);
  const items = (Array.isArray(h.items) ? h.items : [])
    .map(item)
    .filter((i): i is HeaderItem => i !== null)
    .slice(0, SITE_ITEMS_MAX);
  return {
    header: { show: h.show === true, align: oneOf(HEADER_ALIGNMENTS, h.align, "spread"), mobileMenu: oneOf(MOBILE_MENUS, h.mobileMenu, "fold"), items },
    footer: { show: f.show === true, text: text(f.text, 300), links: links(f.links), social: social(f.social) },
  };
}

/** Every media asset the template uses, to be made public with it. */
export function siteAssetIds(site: SiteTemplate): string[] {
  return [...new Set(site.header.items.flatMap((i) => (i.type === "logo" && i.logoAssetId ? [i.logoAssetId] : [])))];
}

/** A new header block with its defaults. */
export function newHeaderItem(type: HeaderItemType): HeaderItem {
  const id = newItemId();
  switch (type) {
    case "logo":
      return { id, type, show: "both", logoAssetId: "", alt: "", href: "/" };
    case "menu":
      return { id, type, show: "both", links: [{ label: "Home", href: "/" }] };
    case "cta":
      return { id, type, show: "both", label: "Join us", href: "", look: "solid" };
    case "social":
      return { id, type, show: "both", links: [{ network: "instagram", href: "" }] };
    case "signin":
      return { id, type, show: "both", label: "Sign in", look: "link" };
  }
}

/** What stops the site template from being published: a block a visitor would meet broken. */
export function siteTemplateIssues(site: SiteTemplate): string[] {
  const issues: string[] = [];
  for (const i of site.header.items) {
    if (i.type === "logo" && i.logoAssetId && !i.alt) issues.push("The logo needs a description (what it says), for people who can't see it.");
    if (i.type === "cta" && (!i.label || !i.href)) issues.push("The header button needs a label and a link.");
    if (i.type === "signin" && !i.label) issues.push("The sign-in link needs a label.");
    if (i.type === "menu" && i.links.some((l) => !l.label || !l.href)) issues.push("Every menu link needs a label and a link.");
    if (i.type === "social" && i.links.some((l) => !l.href)) issues.push("Every social link needs a link.");
  }
  if (site.footer.links.some((l) => !l.label || !l.href)) issues.push("Every footer link needs a label and a link.");
  if (site.footer.social.some((l) => !l.href)) issues.push("Every footer social link needs a link.");
  return [...new Set(issues)];
}

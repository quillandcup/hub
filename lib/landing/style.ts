/**
 * The style guide for the page builder (docs/product/LANDING_PAGES.md, "Settings"): a few design tokens chosen from short lists, never a
 * free colour or font. The site template holds the site's tokens, which every website page uses; a landing page uses the site's
 * too, unless it has its own override for the group. `resolveStyle` is the one place that decides which value wins, used by the
 * editor's canvas and by the public renderer alike. Pure helpers, safe in the browser and on the server.
 *
 * The values are class names (`lp-bg-cream`, `lp-primary-brown`, ...), defined once in `app/globals.css`, so Tailwind finds the
 * strings and a token can't carry anything but a name from the lists below.
 */

export const PAGE_BACKGROUNDS = [
  { value: "default", label: "Theme (follows light and dark mode)" },
  { value: "white", label: "White" },
  { value: "cream", label: "Cream" },
  { value: "blush", label: "Blush" },
  { value: "mist", label: "Mist" },
] as const;
export const PRIMARY_COLORS = [
  { value: "plum", label: "Plum" },
  { value: "brown", label: "Warm brown" },
  { value: "teal", label: "Teal" },
  { value: "charcoal", label: "Charcoal" },
] as const;
export const BUTTON_SIZES = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
] as const;
export const BUTTON_STYLES = [
  { value: "solid", label: "Solid (filled)" },
  { value: "outline", label: "Outline" },
] as const;
export const BUTTON_TEXTS = [
  { value: "auto", label: "Automatic (readable on the primary colour)" },
  { value: "light", label: "White" },
  { value: "dark", label: "Dark" },
] as const;
export const BUTTON_RADII = [
  { value: "pill", label: "Pill" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
] as const;
export const FONT_FAMILIES = [
  { value: "default", label: "Sans (as the app)" },
  { value: "modern", label: "Modern sans" },
  { value: "serif", label: "Brand serif" },
  { value: "classic", label: "Classic serif" },
] as const;
export const FONT_WEIGHTS = [
  { value: "normal", label: "Regular" },
  { value: "medium", label: "Medium" },
] as const;
export const LINE_HEIGHTS = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
] as const;

type Values<T extends readonly { value: string }[]> = T[number]["value"];

export type StyleTokens = {
  pageBackground: Values<typeof PAGE_BACKGROUNDS>;
  primary: Values<typeof PRIMARY_COLORS>;
  buttonSize: Values<typeof BUTTON_SIZES>;
  buttonRadius: Values<typeof BUTTON_RADII>;
  buttonStyle: Values<typeof BUTTON_STYLES>;
  buttonText: Values<typeof BUTTON_TEXTS>;
  fontFamily: Values<typeof FONT_FAMILIES>;
  fontWeight: Values<typeof FONT_WEIGHTS>;
  lineHeight: Values<typeof LINE_HEIGHTS>;
};
export type StyleKey = keyof StyleTokens;

/** What a page looks like when nothing is chosen: the look before the style guide existed. */
export const STYLE_DEFAULTS: StyleTokens = { pageBackground: "default", primary: "plum", buttonSize: "medium", buttonRadius: "pill", buttonStyle: "solid", buttonText: "auto", fontFamily: "default", fontWeight: "normal", lineHeight: "normal" };

const LISTS: Record<StyleKey, readonly { value: string }[]> = {
  pageBackground: PAGE_BACKGROUNDS,
  primary: PRIMARY_COLORS,
  buttonSize: BUTTON_SIZES,
  buttonRadius: BUTTON_RADII,
  buttonStyle: BUTTON_STYLES,
  buttonText: BUTTON_TEXTS,
  fontFamily: FONT_FAMILIES,
  fontWeight: FONT_WEIGHTS,
  lineHeight: LINE_HEIGHTS,
};
export const STYLE_KEYS = Object.keys(LISTS) as StyleKey[];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const inList = (key: StyleKey, v: unknown): boolean => typeof v === "string" && LISTS[key].some((o) => o.value === v);

/** A stored style, whatever its shape: every token, each one from its list or the default. */
export function normalizeStyle(value: unknown): StyleTokens {
  const v = obj(value);
  const out = { ...STYLE_DEFAULTS };
  for (const key of STYLE_KEYS) if (inList(key, v[key])) (out as Record<string, unknown>)[key] = v[key];
  return out;
}

/** A page's own style, as stored in its root: only the tokens it sets, each from its list. Nothing (or nothing valid) is `null`: the page follows the site. */
export function normalizeStyleOverride(value: unknown): Partial<StyleTokens> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = obj(value);
  const out: Partial<StyleTokens> = {};
  for (const key of STYLE_KEYS) if (inList(key, v[key])) (out as Record<string, unknown>)[key] = v[key];
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The style a page is drawn with: the defaults, then the site's tokens, then the page's own where it has an override. A token
 * the page doesn't set follows the site, so changing the site's value later changes every page that doesn't override it.
 */
export function resolveStyle(site: Partial<StyleTokens> | null | undefined, override?: unknown): StyleTokens {
  return { ...STYLE_DEFAULTS, ...normalizeStyleOverride(site), ...normalizeStyleOverride(override) };
}

/** The class names that draw a style on a page's frame (defined in `app/globals.css`). The defaults add none, so an unstyled page is unchanged. */
export function styleClasses(style: StyleTokens): string {
  const classes: string[] = [];
  if (style.pageBackground !== "default") classes.push("landing-light", `lp-bg-${style.pageBackground}`);
  if (style.primary !== "plum") classes.push(`lp-primary-${style.primary}`);
  if (style.buttonSize !== "medium") classes.push(`lp-btn-size-${style.buttonSize}`);
  if (style.buttonRadius !== "pill") classes.push(`lp-btn-radius-${style.buttonRadius}`);
  if (style.buttonStyle !== "solid") classes.push(`lp-btn-style-${style.buttonStyle}`);
  if (style.buttonText !== "auto") classes.push(`lp-btn-text-${style.buttonText}`);
  if (style.fontFamily !== "default") classes.push(`lp-font-${style.fontFamily}`);
  if (style.fontWeight !== "normal") classes.push(`lp-weight-${style.fontWeight}`);
  if (style.lineHeight !== "normal") classes.push(`lp-leading-${style.lineHeight}`);
  return classes.join(" ");
}

/** Whether the page has its own value for any token (the page's settings then say "own style"; none means it follows the site). */
export const hasStyleOverride = (override: unknown): boolean => normalizeStyleOverride(override) !== null;

/**
 * The favicon a page shows: its own when it has an override (`undefined` follows the site), otherwise the site's. An override that
 * is an empty string means "no favicon of its own": the app's default icon, even if the site has one.
 */
export function resolveFaviconAssetId(siteAssetId: string | null | undefined, override: unknown): string {
  if (typeof override === "string") return override.trim();
  return siteAssetId?.trim() ?? "";
}

/** The page's own overrides, read from its document's root (`styleOverride`, `faviconOverrideAssetId`). */
export function pageOverrides(data: unknown): { style: unknown; favicon: string | undefined } {
  const props = obj(obj(obj(data).root).props);
  return { style: props.styleOverride, favicon: typeof props.faviconOverrideAssetId === "string" ? props.faviconOverrideAssetId : undefined };
}

/** Largest favicon the settings accept, in pixels on a side (a larger source is a wasted download). */
export const FAVICON_MIN_PX = 32;
export const FAVICON_MAX_PX = 512;
const FAVICON_TYPES = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "image/webp"];

/** What is wrong with a picture as a favicon, in words for the person choosing it, or null when it will do. Needs a square PNG (or similar), 32 to 512 pixels on a side. */
export function faviconProblem(asset: { mime_type?: string | null; width: number | null; height: number | null }): string | null {
  // An unknown type (the picker knows the size, not the type) is checked again where the picture is read in full, on publish.
  if (asset.mime_type !== undefined && (!asset.mime_type || !FAVICON_TYPES.includes(asset.mime_type))) return "Use a PNG (or an ICO, SVG or WebP) picture for the favicon.";
  if (!asset.width || !asset.height) return "That picture has no size we can read. Use a square PNG, 32 by 32 pixels or more.";
  if (asset.width !== asset.height) return `A favicon has to be square. That picture is ${asset.width} by ${asset.height} pixels.`;
  if (asset.width < FAVICON_MIN_PX) return `That picture is ${asset.width} by ${asset.height} pixels. A favicon needs to be at least ${FAVICON_MIN_PX} by ${FAVICON_MIN_PX}.`;
  if (asset.width > FAVICON_MAX_PX) return `That picture is ${asset.width} by ${asset.height} pixels. Use one no larger than ${FAVICON_MAX_PX} by ${FAVICON_MAX_PX}.`;
  return null;
}

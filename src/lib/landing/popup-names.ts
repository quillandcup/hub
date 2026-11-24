import { POPUP_NAME_MAX, normalizePopupName } from "@/lib/landing/exit-popup";

/**
 * The names given to Exit popups across the site's pages, for the "Popup name" choice in the editor (docs/product/LANDING_PAGES.md,
 * "Exit popup"). Pure: the editor's page loads the documents (`LandingPageRepository.popupSources`) and this reads the names from them.
 */

export type PopupSource = { slug: string; title: string; draft_data: unknown; published_data: unknown };
/** A name in use: how it is spelled (the first spelling met wins), and the pages that use it. */
export type PopupNameUse = { name: string; pages: { slug: string; title: string }[] };

type Node = { type?: unknown; props?: Record<string, unknown> };

function namesIn(value: unknown, into: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) namesIn(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Node;
  if (node.type === "ExitPopup" && typeof node.props?.popupName === "string") {
    const spelled = node.props.popupName.trim().replace(/\s+/g, " ").slice(0, POPUP_NAME_MAX);
    if (spelled) into.push(spelled);
  }
  if (node.props && typeof node.props === "object") for (const v of Object.values(node.props)) namesIn(v, into);
  if (Array.isArray((value as { content?: unknown }).content)) namesIn((value as { content: unknown }).content, into);
}

/**
 * The popup names in use on the pages' drafts and published copies, one entry per name regardless of case ("Newsletter" and
 * "newsletter" are one), spelled as first met (pages are read in the order given, the draft before the published copy), sorted by name.
 */
export function collectPopupNames(sources: PopupSource[]): PopupNameUse[] {
  const found = new Map<string, PopupNameUse>();
  for (const source of sources) {
    const names: string[] = [];
    namesIn(source.draft_data, names);
    namesIn(source.published_data, names);
    for (const spelled of names) {
      const key = normalizePopupName(spelled);
      const use = found.get(key) ?? { name: spelled, pages: [] };
      if (!use.pages.some((p) => p.slug === source.slug)) use.pages.push({ slug: source.slug, title: source.title });
      found.set(key, use);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The choices for the dropdown: "This page only" first (empty value), then every name in use; the block's own name is added when no page has it yet. */
export function popupNameOptions(uses: PopupNameUse[], current: string): { label: string; value: string }[] {
  const options = [{ label: "This page only", value: "" }, ...uses.map((u) => ({ label: u.name, value: u.name }))];
  const own = current.trim();
  if (own && !uses.some((u) => normalizePopupName(u.name) === normalizePopupName(own))) options.push({ label: own, value: own });
  return options;
}

/** What to store for a name typed under "New name...": trimmed, short, and the existing spelling when a name that differs only in case or spacing is in use. Empty for nothing typed. */
export function resolvePopupName(typed: string, uses: PopupNameUse[]): string {
  const spelled = typed.trim().replace(/\s+/g, " ").slice(0, POPUP_NAME_MAX);
  if (!spelled) return "";
  return uses.find((u) => normalizePopupName(u.name) === normalizePopupName(spelled))?.name ?? spelled;
}

/** The other pages that use this name (not `exceptSlug`, the page being edited), for the hint under the choice. */
export function pagesSharing(uses: PopupNameUse[], name: string, exceptSlug: string): { slug: string; title: string }[] {
  const key = normalizePopupName(name);
  if (!key) return [];
  return uses.find((u) => normalizePopupName(u.name) === key)?.pages.filter((p) => p.slug !== exceptSlug) ?? [];
}

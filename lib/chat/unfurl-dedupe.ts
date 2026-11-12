import type { CardUnfurl } from "@/lib/chat/unfurls";
import type { LinkPreview } from "@/lib/data/chat-link-previews";

/**
 * A message written in the Hub is posted to Slack with unfurling on, so Slack answers with its own preview of a link (a
 * `message_changed` event, seconds later) while the Hub has already made one itself (lib/chat/link-previews.ts). Both are stored,
 * but a reader should see one card per link: the Hub's, because it is already showing. Slack's card is the fallback for a link the
 * Hub has no preview for (the page could not be read, was blocked, was never looked at). Pure.
 */

/** Tracking parameters that don't change which page an address is. */
const TRACKING_PARAM = /^(utm_[a-z0-9_]*|fbclid|gclid|mc_cid|mc_eid|igshid)$/i;

/**
 * An address reduced to what identifies the page, for comparing the address Slack reports with the one the Hub stored: the scheme
 * (http and https are the same page for this purpose), lower-case host without `www.`, no fragment, no trailing slash, no tracking
 * parameters, remaining parameters sorted. Null when it is not an address.
 */
export function normalizeLinkForMatch(address: string | null | undefined): string | null {
  if (!address) return null;
  let u: URL;
  try {
    u = new URL(address);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.port ? `:${u.port}` : ""}${path}${query ? `?${query}` : ""}`;
}

/** The normalized addresses of the links the Hub has a drawable (`ok`) preview for: the address as written and where it ended up. */
export function previewedAddresses(previews: LinkPreview[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const p of previews ?? []) {
    if (p.status !== "ok") continue;
    for (const a of [p.url, p.finalUrl]) {
      const n = normalizeLinkForMatch(a);
      if (n) out.add(n);
    }
  }
  return out;
}

/** Whether this Slack card is Slack's preview of a link the Hub has already made one for (matched on its original, source or title address). */
export function isDuplicateOfHubPreview(card: CardUnfurl, previewed: Set<string>): boolean {
  if (previewed.size === 0 || card.hubPreview) return false;
  return [card.originalUrl, card.fromUrl, card.titleLink].some((a) => {
    const n = normalizeLinkForMatch(a);
    return n !== null && previewed.has(n);
  });
}

import { decodePage, parsePagePreview } from "@/lib/chat/link-preview-html";
import { safeImageUrl } from "@/lib/chat/unfurls";
import { writtenLinks } from "@/lib/chat/written-links";
import { APP_URL } from "@/lib/config";
import type { ChatLinkPreviewRepository, LinkPreviewDraft } from "@/lib/data/chat-link-previews";
import { fetchPage, type FetchPageResult } from "@/lib/net/safe-fetch";

/**
 * Link previews for messages written in the Hub (docs/SLACK_BRIDGED_CHAT.md, "Link previews"). Slack builds none for them (the Hub
 * posts with unfurling off), so the server does it once, after the message is sent and again only when an edit changes its links:
 * never when a message is read, never from a viewer's request. `previewLinksIn` says which addresses, `buildPreview` looks at one and
 * `refreshLinkPreviews` does it for a message. Server only (it fetches); drawing a stored preview is `link-preview-cards.ts`.
 */

/** A message gets at most this many previews, for the first links in it. */
export const MAX_PREVIEW_LINKS = 3;

/** The addresses in the text that may get a preview, in order: https only, no duplicates, none in code, none of our own pages. */
export function previewLinksIn(body: string, ownOrigin: string | null = null): string[] {
  const out: string[] = [];
  for (const url of writtenLinks(body)) {
    if (!url.startsWith("https://") || out.includes(url)) continue;
    if (ownOrigin && new URL(url).origin === ownOrigin) continue;
    out.push(url);
    if (out.length === MAX_PREVIEW_LINKS) break;
  }
  return out;
}

/** Whether an address is on the Hub's own origin (`APP_URL`, compared exactly). */
export function isOwnAddress(url: string): boolean {
  try {
    return new URL(url).origin === new URL(APP_URL).origin;
  } catch {
    return false;
  }
}

const empty = (url: string, position: number, status: "failed" | "blocked"): LinkPreviewDraft => ({
  url,
  position,
  finalUrl: null,
  kind: "link",
  status,
  title: null,
  description: null,
  siteName: null,
  imageUrl: null,
});

/** Looks at one address and says what a card for it would hold. Never throws: a page that can't be read is a `failed` or `blocked` draft. */
export async function buildPreview(url: string, position: number, fetchTheAddress: (url: string) => Promise<FetchPageResult> = fetchPage): Promise<LinkPreviewDraft> {
  // Never our own pages: the server is not signed in, so what it would read is the login page (a link to the Hub gets its own card, lib/chat/hub-link-cards.ts).
  if (isOwnAddress(url)) return empty(url, position, "blocked");
  let page: FetchPageResult;
  try {
    page = await fetchTheAddress(url);
  } catch {
    return empty(url, position, "failed");
  }
  if (!page.ok) return empty(url, position, page.reason === "blocked" || page.reason === "invalid_url" ? "blocked" : "failed");
  if (page.kind === "image") {
    return { ...empty(url, position, "failed"), status: "ok", kind: "image", finalUrl: page.finalUrl, imageUrl: safeImageUrl(page.finalUrl) };
  }
  const preview = parsePagePreview(decodePage(page.bytes, page.contentType), page.finalUrl);
  // A page with neither a title nor a description has nothing to show.
  if (!preview.title && !preview.description) return { ...empty(url, position, "failed"), finalUrl: page.finalUrl };
  return { url, position, finalUrl: page.finalUrl, kind: "link", status: "ok", ...preview };
}

/**
 * Brings a message's previews up to date with its text: looks at the links that were never looked at (a failed or blocked one counts as
 * looked at, so it is not asked for again), forgets the ones the text no longer has. Service role. Never throws.
 */
export async function refreshLinkPreviews(
  repo: ChatLinkPreviewRepository,
  messageId: string,
  body: string,
  opts: { ownOrigin?: string | null; fetchTheAddress?: (url: string) => Promise<FetchPageResult> } = {}
): Promise<{ looked: LinkPreviewDraft[] }> {
  try {
    // Our own origin is never looked at, whatever the caller passed.
    const links = previewLinksIn(body, opts.ownOrigin ?? new URL(APP_URL).origin);
    const already = await repo.looked(messageId);
    const fresh = links.map((url, position) => ({ url, position })).filter((l) => !already.has(l.url));
    const looked = await Promise.all(fresh.map((l) => buildPreview(l.url, l.position, opts.fetchTheAddress)));
    await repo.save(messageId, looked);
    await repo.forget(messageId, links);
    return { looked };
  } catch (error) {
    // The address can carry a token, so only the message is named.
    console.error("[chat] link previews of %s failed:", messageId, error instanceof Error ? error.message : "unknown error");
    return { looked: [] };
  }
}

import { cleanText, MAX_SITE_NAME, MAX_TITLE } from "@/lib/chat/link-preview-html";
import { safeImageUrl, safeLinkUrl, type CardUnfurl, type Unfurl } from "@/lib/chat/unfurls";
import type { LinkPreview } from "@/lib/data/chat-link-previews";
import { isDuplicateOfHubPreview, previewedAddresses } from "@/lib/chat/unfurl-dedupe";

/**
 * Drawing a stored link preview (lib/chat/link-previews.ts makes them): the card the chat already knows, the key that removes it, and the
 * list of a message's cards with the removed ones dropped. Pure, no network, so the loader, the picture route and the page can all use it.
 */

/** The card the chat draws for a stored preview, or null when there is nothing to draw. The picture is still the page's own address here; the loader sends it through our picture route. */
export function previewToCard(p: LinkPreview): CardUnfurl | null {
  if (p.status !== "ok") return null;
  const link = safeLinkUrl(p.finalUrl ?? p.url) ?? safeLinkUrl(p.url);
  const written = safeLinkUrl(p.url);
  const removeKey = written ? `url:${written}` : undefined;
  if (!link) return null;
  const imageUrl = safeImageUrl(p.imageUrl);
  if (p.kind === "image") {
    // An address that is itself a picture: the picture, linked to where it lives, with the host as its site.
    return imageUrl ? { ...blankCard(), hubPreview: true, removeKey, imageUrl, titleLink: link, serviceName: hostOf(link), fromUrl: link } : null;
  }
  const title = cleanText(p.title, MAX_TITLE);
  const text = cleanText(p.description, 600);
  if (!title && !text) return null;
  return {
    ...blankCard(),
    title: title ?? hostOf(link),
    titleLink: link,
    text,
    hubPreview: true,
    removeKey,
    imageUrl,
    serviceName: cleanText(p.siteName, MAX_SITE_NAME) ?? hostOf(link),
    fromUrl: link,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function blankCard(): CardUnfurl {
  return { kind: "card", color: null, authorName: null, authorLink: null, pretext: null, title: null, titleLink: null, text: null, fields: [], imageUrl: null, thumbUrl: null, serviceName: null, fromUrl: null, footer: null };
}

/**
 * The key an author's removal of a card is stored under (`chat_hidden_unfurls.key`): `url:<address>` for a card that has one (a Hub preview is
 * keyed by the address that was written in the message, so an edit that fetches it again finds the mark), else `idx:<n>`, its place among the
 * message's cards. Only cards can be removed: an app's blocks are the message itself.
 */
export function unfurlKey(u: Unfurl, index: number): string | null {
  if (u.kind !== "card") return null;
  if (u.removeKey) return u.removeKey;
  const address = u.fromUrl ?? u.titleLink;
  return address ? `url:${address}` : `idx:${index}`;
}

/**
 * A message's cards with its link previews after them, in the order the links were written, minus the ones its author removed (`hidden`: the
 * message's keys from `ChatLinkPreviewRepository.hiddenKeys`); each remaining card says which key removes it. The loader and the picture route
 * both use this, so a picture's position means the same on both sides and a removed card's picture is refused.
 */
export function withLinkPreviews(unfurls: Unfurl[], previews: LinkPreview[] | undefined, hidden?: Set<string>): Unfurl[] {
  const hubCards = (previews ?? []).flatMap((p) => previewToCard(p) ?? []);
  const all = [...unfurls, ...hubCards];
  // A message written in the Hub is unfurled by Slack too: where the Hub has its own card for a link, Slack's card for that link is dropped
  // (lib/chat/unfurl-dedupe.ts), so the reader sees one. The index below is the place before dropping, so an `idx:` mark keeps pointing at
  // the same card whether or not Slack's duplicate has arrived yet.
  const previewed = previewedAddresses(previews);
  return all.flatMap((u, i): Unfurl[] => {
    if (u.kind === "card" && isDuplicateOfHubPreview(u, previewed)) return [];
    const key = unfurlKey(u, i);
    if (!key) return [u];
    return hidden?.has(key) ? [] : [{ ...u, removeKey: key } as Unfurl];
  });
}

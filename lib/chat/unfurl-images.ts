import { createHash } from "node:crypto";
import type { Unfurl, UnfurlBlock } from "@/lib/chat/unfurls";
import { parseSharedMessage } from "@/lib/chat/shared-message";

/**
 * The pictures under a Slack message (link previews, app cards, an app's blocks, the app's own logo, the author of a quoted
 * message) live on other people's servers. Loading them straight from the page tells each of those servers who looked and
 * when, so they go through our own route instead (`/api/chat/unfurl-image`, app/api/chat/unfurl-image/route.ts).
 *
 * The route is told a message and a key, never an address: it reads the message as the viewer, lists its pictures
 * with the same walk used here, and fetches the one whose key matches. So the browser can't make the server fetch an address
 * of its choosing. `walkUnfurlImages` is that one walk: the loader rewrites with it and the route lists with it.
 *
 * A picture is named by a hash of its source address, never by its position. A position shifts whenever the list changes
 * (the app's logo, which Slack's echo of a message posted through the Hub adds as position 0 a moment after it is sent;
 * a card Slack or the Hub adds before it), so a page drawn a moment earlier asked for the wrong picture, and the browser
 * kept the answer for a day. A key means the same picture in every state of the message, and a key that is no longer in
 * the list is a 404 (the card shows no picture).
 */

export const UNFURL_IMAGE_PATH = "/api/chat/unfurl-image";

/** The stable name of a picture: the first 16 hex digits of sha256 of its source address. */
export function unfurlPictureKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** The address the page loads the picture with this key from. */
export function unfurlImageSrc(messageId: string, key: string): string {
  return `${UNFURL_IMAGE_PATH}?m=${encodeURIComponent(messageId)}&k=${key}`;
}

type Visit = (url: string) => string;

function visitBlock(b: UnfurlBlock, visit: Visit): UnfurlBlock {
  switch (b.type) {
    case "section":
      return b.image ? { ...b, image: { ...b.image, url: visit(b.image.url) } } : b;
    case "context":
      return { ...b, items: b.items.map((item) => (item.kind === "image" ? { ...item, image: { ...item.image, url: visit(item.image.url) } } : item)) };
    case "image":
      return { ...b, image: { ...b.image, url: visit(b.image.url) } };
    default:
      return b;
  }
}

/**
 * Calls `visit` once for every external picture of a message, in a fixed order (the app's logo first, then each card in
 * turn), and returns the cards with each address replaced by what `visit` returned.
 */
export function walkUnfurlImages(unfurls: Unfurl[], botIcon: string | null, visit: Visit): { botIcon: string | null; unfurls: Unfurl[] } {
  const bot = botIcon ? visit(botIcon) : null;
  const out = unfurls.map((u): Unfurl => {
    if (u.kind === "card") {
      const imageUrl = u.imageUrl ? visit(u.imageUrl) : null;
      const thumbUrl = u.thumbUrl ? visit(u.thumbUrl) : null;
      return { ...u, imageUrl, thumbUrl };
    }
    if (u.kind === "blocks") return { ...u, blocks: u.blocks.map((b) => visitBlock(b, visit)) };
    // A card for a page of the Hub has no external picture.
    if (u.kind === "hub") return u;
    // A quoted message: its author's picture. Counted from the attachment, which is all the route has; drawn when the loader has filled `shared`.
    const icon = parseSharedMessage(u.attachment)?.authorIcon ?? null;
    const proxied = icon ? visit(icon) : null;
    return u.shared && proxied ? { ...u, shared: { ...u.shared, authorIcon: proxied } } : u;
  });
  return { botIcon: bot, unfurls: out };
}

/** The addresses of a message's pictures, in position order. */
export function unfurlImageUrls(unfurls: Unfurl[], botIcon: string | null): string[] {
  const urls: string[] = [];
  walkUnfurlImages(unfurls, botIcon, (url) => (urls.push(url), url));
  return urls;
}

/** The cards and logo with every external picture replaced by our route's address for it. */
export function proxyUnfurlImages(messageId: string, unfurls: Unfurl[], botIcon: string | null): { botIcon: string | null; unfurls: Unfurl[] } {
  return walkUnfurlImages(unfurls, botIcon, (url) => unfurlImageSrc(messageId, unfurlPictureKey(url)));
}

import type { Unfurl, UnfurlBlock } from "@/lib/chat/unfurls";
import { parseSharedMessage } from "@/lib/chat/shared-message";

/**
 * The pictures under a Slack message (link previews, app cards, an app's blocks, the app's own logo, the author of a quoted
 * message) live on other people's servers. Loading them straight from the page tells each of those servers who looked and
 * when, so they go through our own route instead (`/api/chat/unfurl-image`, app/api/chat/unfurl-image/route.ts).
 *
 * The route is told a message and a position, never an address: it reads the message as the viewer, lists its pictures
 * with the same walk used here, and fetches the one at that position. So the browser can't make the server fetch an address
 * of its choosing. `walkUnfurlImages` is that one walk: the loader rewrites with it and the route lists with it, so a
 * position means the same picture on both sides. Position 0 is the app's logo when the message has one; after that the
 * pictures come in the order they are drawn.
 */

export const UNFURL_IMAGE_PATH = "/api/chat/unfurl-image";

/** The address the page loads a message's `index`-th picture from. */
export function unfurlImageSrc(messageId: string, index: number): string {
  return `${UNFURL_IMAGE_PATH}?m=${encodeURIComponent(messageId)}&i=${index}`;
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
  let i = 0;
  return walkUnfurlImages(unfurls, botIcon, () => unfurlImageSrc(messageId, i++));
}

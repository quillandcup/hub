import { hubLinksIn } from "@/lib/chat/hub-links";
import { isDuplicateOfHubPreview, normalizeLinkForMatch } from "@/lib/chat/unfurl-dedupe";
import type { HubLinkUnfurl, Unfurl } from "@/lib/chat/unfurls";

/**
 * Where a message's links to the Hub become cards (docs/SLACK_BRIDGED_CHAT.md, "Hub links"). Pure, so the loader and its tests share it.
 * Nothing here knows what a link points at: that is read per viewer when the card draws (lib/chat/hub-link-card.ts).
 */

/** The Hub links in a message's text, as unfurls waiting for a card. */
export function hubLinkUnfurls(body: string | null | undefined, appUrl: string): HubLinkUnfurl[] {
  return hubLinksIn(body, appUrl).map(({ url, link }) => ({ kind: "hub", url, link }));
}

/**
 * `unfurls` with the Hub's cards for the links to the Hub in the message. Slack's own card for such a link is dropped, hidden or not: it
 * is the sign-in page Slack's crawler was sent to ("Login | Hedgie Hub"), never the page. `hidden` is the keys the message's author removed
 * (`url:<address>`): a removed card is left out, and with no answer (null: the read failed) none is drawn, so a removal is never undone.
 */
export function withHubLinks(unfurls: Unfurl[], hubLinks: HubLinkUnfurl[], hidden: Set<string> | null): Unfurl[] {
  if (hubLinks.length === 0) return unfurls;
  const addresses = new Set(hubLinks.flatMap((h) => normalizeLinkForMatch(h.url) ?? []));
  const kept = unfurls.filter((u) => !(u.kind === "card" && isDuplicateOfHubPreview(u, addresses)));
  const shown = hidden ? hubLinks.filter((h) => !hidden.has(`url:${h.url}`)).map((h): HubLinkUnfurl => ({ ...h, removeKey: `url:${h.url}` })) : [];
  return [...kept, ...shown];
}

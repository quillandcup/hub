import { isId } from "@/lib/ids";
import { writtenLinks } from "@/lib/chat/written-links";

/**
 * Links to the Hub itself, written in a chat message (docs/SLACK_BRIDGED_CHAT.md, "Hub links"). Which pages have a card, and what a link to one
 * looks like, is decided here and nowhere else: the loader uses it to find the links in a message, and the card route uses it to read the
 * address it is asked about, so the two cannot disagree. Pure: no database, no React.
 *
 * Only ids a person can see (`msg_`, `chn_`, `prkl_`, `mbr_`) are in these addresses; the shapes are the ones the pages themselves have.
 */

export type HubLink =
  /** A conversation with `?m=<message id>`: "Copy link" on a message, "View in Chat", the link a shared lesson video adds for Slack. */
  | { kind: "message"; channelId: string; messageId: string }
  | { kind: "prickle"; prickleId: string }
  | { kind: "member"; memberId: string };

export type HubLinkKind = HubLink["kind"];

/** A message gets at most this many Hub cards. */
export const MAX_HUB_LINKS = 3;

const isLocalHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1";

/**
 * The page a link goes to when it is on the Hub's own origin and has the shape of a page that has a card, else null. The origin is compared
 * exactly (`appUrl`'s scheme, host and port: no look-alike host, no `user@host`), it must be https (a local `localhost` address is the one
 * exception, for development), and the id in the path must be a well-formed id of the right table.
 */
export function parseHubLink(address: string, appUrl: string): HubLink | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(address);
    base = new URL(appUrl);
  } catch {
    return null;
  }
  if (url.origin !== base.origin || url.username || url.password) return null;
  if (url.protocol !== "https:" && !isLocalHost(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");

  const chat = /^\/chat\/([^/]+)$/.exec(path);
  if (chat) {
    const message = url.searchParams.get("m");
    // Only a link to one message: the conversation itself has nothing to quote.
    return isId(chat[1], "chn") && isId(message, "msg") ? { kind: "message", channelId: chat[1], messageId: message } : null;
  }
  const prickle = /^\/prickles\/([^/]+)$/.exec(path);
  if (prickle) return isId(prickle[1], "prkl") ? { kind: "prickle", prickleId: prickle[1] } : null;
  const member = /^\/members\/([^/]+)$/.exec(path);
  if (member) return isId(member[1], "mbr") ? { kind: "member", memberId: member[1] } : null;
  return null;
}

/** The path (on the Hub's origin) the card opens: rebuilt from the parsed ids, never copied from what was written. */
export function hubLinkPath(link: HubLink): string {
  switch (link.kind) {
    case "message":
      return `/chat/${link.channelId}?m=${link.messageId}`;
    case "prickle":
      return `/prickles/${link.prickleId}`;
    case "member":
      return `/members/${link.memberId}`;
  }
}

/** The same page, whichever way it was written: for telling two addresses apart. */
export const hubLinkKey = (link: HubLink): string => hubLinkPath(link);

export interface HubLinkRef {
  /** The address as written in the message (what a removal mark is keyed by). */
  url: string;
  link: HubLink;
}

/** The Hub links written in a message's text, in order, once per page, at most {@link MAX_HUB_LINKS}. */
export function hubLinksIn(body: string | null | undefined, appUrl: string): HubLinkRef[] {
  if (!body) return [];
  const out: HubLinkRef[] = [];
  const seen = new Set<string>();
  for (const url of writtenLinks(body)) {
    const link = parseHubLink(url, appUrl);
    if (!link || seen.has(hubLinkKey(link))) continue;
    seen.add(hubLinkKey(link));
    out.push({ url, link });
    if (out.length === MAX_HUB_LINKS) break;
  }
  return out;
}

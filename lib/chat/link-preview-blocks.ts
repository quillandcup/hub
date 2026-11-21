/**
 * A member's blocked link previews (docs/product/SLACK_BRIDGED_CHAT.md, "Link previews"): a rule they made in the "Remove preview" dialog
 * that stops the Hub building a card for the links in the messages they write from then on. Three scopes, from widest to narrowest:
 * - `site`: every address on the same host (a leading `www.` does not count);
 * - `path`: addresses on that host whose path is the address's first path segment or below it, matched on a segment boundary
 *   (`/wiki` covers `/wiki` and `/wiki/x`, never `/wikipedia`);
 * - `link`: exactly that address (the fragment is not part of an address; a query is).
 * Only https addresses can get a preview, so only https addresses can be blocked. User info and a port are not part of a rule's host.
 * Pure: no network, no database; the server computes a rule from the card's own address, never from what a browser sends.
 */

import { writtenLinks } from "@/lib/chat/written-links";

export type BlockScope = "site" | "path" | "link";

export const BLOCK_SCOPES: readonly BlockScope[] = ["site", "path", "link"];

/** One stored rule. `pathPrefix` is set only for `path`, `url` only for `link`. */
export interface PreviewBlock {
  scope: BlockScope;
  host: string;
  pathPrefix: string | null;
  url: string | null;
}

export interface BlockOption {
  scope: BlockScope;
  label: string;
}

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const MAX_HOST = 253;
const MAX_PATH_PREFIX = 200;
const MAX_URL = 2000;
/** The longest "host/path" shown in an option before it is cut with an ellipsis. */
const MAX_LABEL_TARGET = 48;

export function isBlockScope(value: unknown): value is BlockScope {
  return value === "site" || value === "path" || value === "link";
}

interface Parsed {
  host: string;
  /** The path as the address has it, always starting with "/". */
  path: string;
  /** The address without user info or fragment, as the rule for `link` stores it. */
  link: string;
}

function parse(address: string): Parsed | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host.length > MAX_HOST || !HOST.test(host)) return null;
  const link = `https://${url.host}${url.pathname}${url.search}`;
  if (link.length > MAX_URL) return null;
  return { host, path: url.pathname, link };
}

/** The first path segment of an address ("/wikipedia"), or null when it has none or it is too long to store. */
function firstSegment(path: string): string | null {
  const segment = path.split("/")[1];
  if (!segment) return null;
  const prefix = `/${segment}`;
  return prefix.length <= MAX_PATH_PREFIX ? prefix : null;
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The scopes offered for an address, widest first, with the sentence for each. None for an address that can't be blocked (not https, or no usable host). */
export function blockOptionsFor(address: string): BlockOption[] {
  const parsed = parse(address);
  if (!parsed) return [];
  const options: BlockOption[] = [{ scope: "site", label: `Block all previews from ${cut(parsed.host, MAX_LABEL_TARGET)}` }];
  const prefix = firstSegment(parsed.path);
  if (prefix) options.push({ scope: "path", label: `Block previews from links under ${cut(`${parsed.host}${prefix}`, MAX_LABEL_TARGET)}/…` });
  options.push({ scope: "link", label: "Block previews from this specific link" });
  return options;
}

/** The rule for blocking an address at a scope, or null when that scope isn't offered for it. */
export function blockFor(address: string, scope: BlockScope): PreviewBlock | null {
  const parsed = parse(address);
  if (!parsed) return null;
  if (scope === "site") return { scope, host: parsed.host, pathPrefix: null, url: null };
  if (scope === "link") return { scope, host: parsed.host, pathPrefix: null, url: parsed.link };
  if (scope === "path") {
    const prefix = firstSegment(parsed.path);
    return prefix ? { scope, host: parsed.host, pathPrefix: prefix, url: null } : null;
  }
  return null;
}

/** Whether one rule covers an address. */
export function blockMatches(block: PreviewBlock, address: string): boolean {
  const parsed = parse(address);
  if (!parsed || parsed.host !== block.host) return false;
  if (block.scope === "site") return true;
  if (block.scope === "link") return block.url === parsed.link;
  const prefix = block.pathPrefix;
  if (!prefix) return false;
  return parsed.path === prefix || parsed.path.startsWith(`${prefix}/`);
}

/** Whether any of the rules covers an address. */
export function isBlocked(address: string, blocks: readonly PreviewBlock[]): boolean {
  return blocks.some((b) => blockMatches(b, address));
}

/** Whether a message has links and the author blocked every one of them (so Slack has nothing to unfurl that they wanted). False for a message without links. */
export function everyLinkBlocked(body: string, blocks: readonly PreviewBlock[]): boolean {
  const links = writtenLinks(body);
  return links.length > 0 && blocks.length > 0 && links.every((l) => isBlocked(l, blocks));
}

/** What a rule says, for the list in settings. */
export function describeBlock(block: PreviewBlock): string {
  if (block.scope === "site") return block.host;
  if (block.scope === "path") return `${block.host}${block.pathPrefix ?? ""}/…`;
  return (block.url ?? block.host).replace(/^https:\/\//, "");
}

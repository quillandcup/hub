import type { OutboundMessage } from "@/lib/channels";

/**
 * Which notification brought a member in. Every Hub link a notification carries (in a Slack DM, an
 * email, a push) gets `nk=<kind>&nc=<channel>`; when the member lands, the browser reads them, records
 * `notification_opened`, and strips them from the address (components/AnalyticsEvents.tsx). In-app
 * notifications aren't tagged: the click is recorded where it happens.
 *
 * Links that aren't "go and do this" are left alone: the unsubscribe links (they carry a signed token
 * and one-click POSTs), API routes, and the notification settings page (opening *that* isn't opening
 * the notification).
 */

export const KIND_PARAM = "nk";
export const CHANNEL_PARAM = "nc";

const UNTAGGED = [/^\/api(\/|$)/, /^\/unsubscribe(\/|$)/, /^\/settings\/notifications(\/|$)/];
const KIND = /^[a-z][a-z0-9_]{0,39}$/;
const CHANNEL = /^[a-z][a-z0-9_]{0,19}$/;
/** Any web address in a piece of text; it ends at whitespace or at what ends a URL in Slack's <url|label>. */
const ANY_URL = /https?:\/\/[^\s<>"'|)\]]+/g;

export interface Attribution {
  kind: string;
  channel: string;
}

/**
 * Whether `url` is a link into the Hub at `appUrl`: the same origin exactly, so `hub.example.test.evil.com`
 * and `hub.example.test:8080` aren't mistaken for `hub.example.test`.
 */
function isHubUrl(url: string, appUrl: string): boolean {
  if (!url.startsWith(appUrl)) return false;
  const rest = url.slice(appUrl.length);
  return rest === "" || /^[/?#]/.test(rest);
}

/** `url` with the attribution added, or unchanged if it isn't a Hub link that should carry one. */
export function withAttribution(url: string, appUrl: string, attribution: Attribution): string {
  if (!isHubUrl(url, appUrl)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (UNTAGGED.some((path) => path.test(parsed.pathname)) || parsed.searchParams.has(KIND_PARAM)) return url;
  parsed.searchParams.set(KIND_PARAM, attribution.kind);
  parsed.searchParams.set(CHANNEL_PARAM, attribution.channel);
  return parsed.toString();
}

/** Tags every Hub link in a piece of text (a message, or Slack's mrkdwn). Trailing punctuation stays outside the link. */
export function attributeText(text: string, appUrl: string, attribution: Attribution): string {
  // Find every web address, then decide which are the Hub's: no pattern is built from the Hub's own address.
  return text.replace(ANY_URL, (match) => {
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    return withAttribution(url, appUrl, attribution) + trailing;
  });
}

function attributeValue<T>(value: T, appUrl: string, attribution: Attribution): T {
  if (typeof value === "string") return attributeText(value, appUrl, attribution) as T;
  if (Array.isArray(value)) return value.map((v) => attributeValue(v, appUrl, attribution)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, attributeValue(v, appUrl, attribution)])) as T;
  }
  return value;
}

/**
 * A message with every Hub link tagged, in its text, its link, its footer links and any Slack blocks,
 * so a feature that builds its own blocks gets attribution without doing anything.
 */
export function attributeMessage(message: OutboundMessage, appUrl: string, attribution: Attribution): OutboundMessage {
  return {
    ...message,
    text: attributeText(message.text, appUrl, attribution),
    ...(message.url ? { url: withAttribution(message.url, appUrl, attribution) } : {}),
    ...(message.slackBlocks ? { slackBlocks: attributeValue(message.slackBlocks, appUrl, attribution) } : {}),
    ...(message.footerLinks
      ? { footerLinks: message.footerLinks.map((l) => ({ ...l, url: withAttribution(l.url, appUrl, attribution) })) }
      : {}),
  };
}

/** The attribution in an address's query string, if it is well formed. */
export function readAttribution(search: string): Attribution | null {
  const params = new URLSearchParams(search);
  const kind = params.get(KIND_PARAM);
  const channel = params.get(CHANNEL_PARAM);
  return kind && channel && KIND.test(kind) && CHANNEL.test(channel) ? { kind, channel } : null;
}

/** An address with the attribution parameters removed (and everything else kept). */
export function stripAttribution(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(KIND_PARAM);
  params.delete(CHANNEL_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

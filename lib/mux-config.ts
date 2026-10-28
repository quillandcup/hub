// Pure logic behind `pnpm mux:config:diff` / `:push` (scripts/mux-config.ts): turn the committed
// mux-config.yml into the desired state, and compare it with what Mux reports. No network and no
// secrets here, so it is unit-tested (tests/lib/mux-config.test.ts). See docs/MUX_CONFIG.md.

export const MAX_ALLOWED_DOMAINS = 10;

/** A webhook as Mux lists it (the signing secret is never part of a list/retrieve response). */
export interface LiveWebhook {
  id: string;
  address: string;
  enabled: boolean;
}

/** A playback restriction as Mux returns it. Restrictions have no name: identified by content. */
export interface LiveRestriction {
  id: string;
  referrer: { allowed_domains: string[]; allow_no_referrer: boolean };
}

export interface DesiredRestriction {
  allowedDomains: string[];
  allowNoReferrer: boolean;
}

export interface MuxConfig {
  /** Path of our webhook route; the address is APP_URL + this. */
  webhookPath: string;
  restriction: DesiredRestriction;
}

export function parseMuxConfig(raw: unknown, appHost: string): MuxConfig {
  const root = (raw ?? {}) as Record<string, unknown>;
  const webhook = (root.webhook ?? {}) as Record<string, unknown>;
  const restriction = (root.playbackRestriction ?? {}) as Record<string, unknown>;

  const path = webhook.path;
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("mux-config.yml: webhook.path must be a path starting with /");
  }
  const domains = restriction.allowedDomains;
  if (!Array.isArray(domains) || domains.some((d) => typeof d !== "string" || !d.trim())) {
    throw new Error("mux-config.yml: playbackRestriction.allowedDomains must be a list of domains");
  }
  if (typeof restriction.allowNoReferrer !== "boolean") {
    throw new Error("mux-config.yml: playbackRestriction.allowNoReferrer must be true or false");
  }
  // {appHost} is the production host from app.config.ts, so no domain is written out twice.
  const allowedDomains = [
    ...new Set((domains as string[]).map((d) => d.trim().replace("{appHost}", appHost))),
  ];
  if (allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    throw new Error(`mux-config.yml: Mux allows at most ${MAX_ALLOWED_DOMAINS} allowed domains`);
  }
  if (allowedDomains.includes("*") && allowedDomains.length > 1) {
    throw new Error('mux-config.yml: a "*" entry must be the only allowed domain');
  }
  return { webhookPath: path, restriction: { allowedDomains, allowNoReferrer: restriction.allowNoReferrer } };
}

export const webhookAddress = (appUrl: string, path: string) => `${appUrl.replace(/\/+$/, "")}${path}`;

/** The address a developer's tunnel serves (TUNNEL_DOMAIN: a bare hostname, see scripts/tunnel-command.ts). */
export function devWebhookAddress(tunnelDomain: string, path: string): string {
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(tunnelDomain)) {
    throw new Error("TUNNEL_DOMAIN should be a bare hostname like your-name.ngrok-free.dev (no https://, path or port)");
  }
  return `https://${tunnelDomain}${path}`;
}

export type WebhookAction =
  | { kind: "ok"; id: string }
  | { kind: "create"; address: string }
  | { kind: "enable"; id: string; address: string }
  | { kind: "update-address"; id: string; from: string; to: string };

/**
 * What to do so a webhook for `address` exists and is enabled. Other webhooks are never touched
 * (reported by the caller as unmanaged), except with `adoptSingle` (a developer's own Mux
 * environment): when exactly one webhook exists at another address, its address is updated, which
 * keeps its signing secret.
 */
export function planWebhook(
  address: string,
  live: readonly LiveWebhook[],
  opts: { adoptSingle?: boolean } = {},
): WebhookAction {
  const match = live.find((w) => w.address === address);
  if (match) {
    return match.enabled ? { kind: "ok", id: match.id } : { kind: "enable", id: match.id, address };
  }
  if (opts.adoptSingle && live.length === 1) {
    return { kind: "update-address", id: live[0].id, from: live[0].address, to: address };
  }
  return { kind: "create", address };
}

/** Webhooks Mux has that the config doesn't declare (left alone; listed so they are visible). */
export const unmanagedWebhooks = (address: string, live: readonly LiveWebhook[]) =>
  live.filter((w) => w.address !== address);

export type RestrictionAction =
  | { kind: "ok"; id: string }
  | { kind: "create" }
  | { kind: "update"; id: string }
  | { kind: "ambiguous"; count: number };

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * The environment has one restriction we manage. None: create. One: update it when it differs.
 * Several: refuse to guess which one is ours (a restriction has no name).
 */
export function planRestriction(want: DesiredRestriction, live: readonly LiveRestriction[]): RestrictionAction {
  if (live.length === 0) return { kind: "create" };
  if (live.length > 1) return { kind: "ambiguous", count: live.length };
  const [one] = live;
  const same =
    sameSet(one.referrer.allowed_domains, want.allowedDomains) &&
    one.referrer.allow_no_referrer === want.allowNoReferrer;
  return same ? { kind: "ok", id: one.id } : { kind: "update", id: one.id };
}

export const restrictionBody = (want: DesiredRestriction) => ({
  allowed_domains: want.allowedDomains,
  allow_no_referrer: want.allowNoReferrer,
});

/**
 * Set `KEY=value` in the text of an env file: replace the line if there is one, else append. Used
 * to save a new webhook's signing secret without it ever being printed.
 */
export function setEnvValue(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, () => line);
  return `${content}${content === "" || content.endsWith("\n") ? "" : "\n"}${line}\n`;
}

/** The value of `KEY` in env file text, or "" when missing or blank. */
export function envValue(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

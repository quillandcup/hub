import { OUTBOUND_USER_AGENT, userAgentWith } from "../config";

/**
 * Every request to a server that is not ours says who we are (docs/OUTBOUND_REQUESTS.md). Raw `fetch` calls to an
 * external host go through `outboundFetch`, or take their headers from `outboundHeaders`;
 * `tests/lib/outbound-user-agent.test.ts` fails on a new external `fetch(` that does neither. Relative import:
 * lib/cron-heartbeats.ts, which the Checkly CLI bundles, uses it.
 */

/**
 * `headers` as a plain object with our User-Agent added, unless the caller set one. `tokens` name the integration
 * (`userAgentWith`). Keys the caller used keep their spelling.
 */
export function outboundHeaders(headers?: HeadersInit, ...tokens: string[]): Record<string, string> {
  const given: Record<string, string> =
    headers instanceof Headers || Array.isArray(headers) ? Object.fromEntries(new Headers(headers)) : { ...(headers as Record<string, string> | undefined) };
  if (Object.keys(given).some((k) => k.toLowerCase() === "user-agent")) return given;
  return { ...given, "User-Agent": tokens.length ? userAgentWith(...tokens) : OUTBOUND_USER_AGENT };
}

/** `fetch` with our User-Agent (see `outboundHeaders`). */
export function outboundFetch(input: string | URL | Request, init: RequestInit = {}, ...tokens: string[]): Promise<Response> {
  return fetch(input, { ...init, headers: outboundHeaders(init.headers, ...tokens) });
}

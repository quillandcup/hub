// Builds the ngrok command for scripts/tunnel.ts. Pure, so it's tested without starting
// anything (tests/lib/tunnel-command.test.ts).

export interface TunnelCommand {
  tool: "ngrok";
  args: string[];
}

export type TunnelPlan =
  | { ok: true; command: TunnelCommand }
  | { ok: false; error: string };

/** Next's default dev port, used when none is given. */
export const DEFAULT_PORT = "3000";

export const TUNNEL_USAGE = `Usage: pnpm tunnel [<port>]

Opens a public https address that forwards to localhost:<port> (default ${DEFAULT_PORT}),
for testing vendor webhooks (Mux, Zoom, Google Calendar, Slack) against your dev server.

Uses ngrok (brew install ngrok, then ngrok config add-authtoken <your token>). Without
TUNNEL_DOMAIN the address is random and changes every run. Set TUNNEL_DOMAIN in .env.local to a
domain reserved on your own ngrok account (a bare hostname, no https://) to keep it the same.`;

/** A bare hostname such as hedgie-hub.ngrok-free.dev: no scheme, path, port or spaces. */
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * @param ngrokInstalled whether ngrok is on PATH
 * @param domain a domain reserved on the developer's ngrok account (TUNNEL_DOMAIN), if any
 */
export function planTunnel(ngrokInstalled: boolean, argv: readonly string[], domain?: string): TunnelPlan {
  const [port = DEFAULT_PORT, ...extra] = argv;
  if (extra.length > 0 || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { ok: false, error: `Expected one port number, got: ${argv.join(" ")}\n\n${TUNNEL_USAGE}` };
  }
  if (domain && !HOSTNAME.test(domain)) {
    return {
      ok: false,
      error: `TUNNEL_DOMAIN should be a bare hostname like your-name.ngrok-free.dev (no https://, path or port), got: ${domain}`,
    };
  }
  if (!ngrokInstalled) {
    return { ok: false, error: "ngrok not found. Install it with `brew install ngrok`." };
  }
  return { ok: true, command: { tool: "ngrok", args: ["http", port, ...(domain ? [`--url=https://${domain}`] : [])] } };
}

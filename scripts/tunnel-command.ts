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

export const TUNNEL_USAGE = `Usage: npm run tunnel [-- <port>]

Opens a public https address that forwards to localhost:<port> (default ${DEFAULT_PORT}),
for testing vendor webhooks (Mux, Zoom, Google Calendar, Slack) against your dev server.

Uses ngrok. TUNNEL_DOMAIN, a reserved ngrok domain, keeps the address the same between runs.`;

/**
 * @param ngrokInstalled whether ngrok is on PATH
 * @param domain a reserved ngrok domain (TUNNEL_DOMAIN), if the developer has one
 */
export function planTunnel(ngrokInstalled: boolean, argv: readonly string[], domain?: string): TunnelPlan {
  const [port = DEFAULT_PORT, ...extra] = argv;
  if (extra.length > 0 || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { ok: false, error: `Expected one port number, got: ${argv.join(" ")}\n\n${TUNNEL_USAGE}` };
  }
  if (!ngrokInstalled) {
    return { ok: false, error: "ngrok not found. Install it with `brew install ngrok`." };
  }
  const args = ["http", port, ...(domain ? [`--url=https://${domain}`] : [])];
  return { ok: true, command: { tool: "ngrok", args } };
}

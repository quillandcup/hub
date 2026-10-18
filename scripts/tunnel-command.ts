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

Uses ngrok. For an address that stays the same between runs, define an endpoint in your ngrok
config (a reserved domain and the port it forwards to) and set TUNNEL_ENDPOINT to its name;
the port then comes from that endpoint, not from this command.`;

/**
 * @param ngrokInstalled whether ngrok is on PATH
 * @param endpoint the name of an endpoint in the developer's ngrok config (TUNNEL_ENDPOINT), if any
 */
export function planTunnel(ngrokInstalled: boolean, argv: readonly string[], endpoint?: string): TunnelPlan {
  if (endpoint && argv.length > 0) {
    return {
      ok: false,
      error: `The "${endpoint}" endpoint sets its own port in your ngrok config, so no port argument is allowed. Unset TUNNEL_ENDPOINT to tunnel an arbitrary port.`,
    };
  }
  const [port = DEFAULT_PORT, ...extra] = argv;
  if (extra.length > 0 || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { ok: false, error: `Expected one port number, got: ${argv.join(" ")}\n\n${TUNNEL_USAGE}` };
  }
  if (!ngrokInstalled) {
    return { ok: false, error: "ngrok not found. Install it with `brew install ngrok`." };
  }
  const args = endpoint ? ["start", endpoint] : ["http", port];
  return { ok: true, command: { tool: "ngrok", args } };
}

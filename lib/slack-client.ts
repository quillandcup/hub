import { WebClient, addAppMetadata, type WebClientOptions } from "@slack/web-api";
import { OUTBOUND_PRODUCT } from "@/lib/config";

/**
 * The one place a Slack Web API client is built. The SDK sets its own User-Agent (package, node and OS) and has no
 * option to add to it except `addAppMetadata`, which puts `name/version` in front of the SDK's, so we say who we are
 * without replacing what Slack's own tooling reads (docs/OUTBOUND_REQUESTS.md). `tests/lib/outbound-user-agent.test.ts`
 * fails on a `new WebClient(` anywhere else.
 */
export function createSlackClient(token?: string, options?: WebClientOptions): WebClient {
  try {
    addAppMetadata(OUTBOUND_PRODUCT);
  } catch {
    // Identifying ourselves must never stop a Slack call (a test double of the SDK may not export it).
  }
  return new WebClient(token, options);
}

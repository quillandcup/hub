import { createHmac } from "crypto";

export type SlackSignatureResult =
  | { valid: true }
  | { valid: false; reason: "missing" | "too_old" | "mismatch" };

/**
 * Slack request signature verification (HMAC-SHA256), shared between the Events API webhook
 * (app/api/webhooks/slack/route.ts) and the interactions webhook (app/api/webhooks/slack/interactions/route.ts)
 * -- extracted so a second inline copy doesn't drift from the first. See
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 *
 * Returns valid:true if signingSecret isn't configured (matches the existing Events API handler's
 * behavior of skipping verification when SLACK_SIGNING_SECRET is unset, e.g. local dev without
 * the secret configured) -- callers that need it enforced should check the env var themselves.
 * `reason` lets callers preserve distinct error messages (e.g. "Request too old" vs "Invalid
 * signature") rather than collapsing every failure into one generic message.
 */
export function verifySlackSignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string | undefined
): SlackSignatureResult {
  if (!signingSecret) return { valid: true };
  if (!signature || !timestamp) return { valid: false, reason: "missing" };

  const requestTimestamp = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTimestamp) > 60 * 5) return { valid: false, reason: "too_old" };

  const sigBasestring = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  return signature === expected ? { valid: true } : { valid: false, reason: "mismatch" };
}

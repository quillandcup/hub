import { createHmac, timingSafeEqual } from "crypto";
import { webhookSecretRequired } from "@/lib/webhook-auth";

export type SlackSignatureResult =
  | { valid: true }
  | { valid: false; reason: "missing" | "too_old" | "mismatch" | "not_configured" };

/**
 * Slack request signature verification (HMAC-SHA256), shared between the Events API webhook
 * (app/api/webhooks/slack/route.ts) and the interactions webhook (app/api/webhooks/slack/interactions/route.ts)
 * -- extracted so a second inline copy doesn't drift from the first. See
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 *
 * With no signingSecret, local dev and tests skip verification (valid:true), but a deployed build
 * (see webhookSecretRequired) rejects with reason "not_configured", so a missing secret can't
 * silently turn the check off. Callers that must never run unverified, even locally, should check
 * the env var themselves (lib/slack-sign-in.ts does).
 * `reason` lets callers preserve distinct error messages (e.g. "Request too old" vs "Invalid
 * signature") rather than collapsing every failure into one generic message.
 */
export function verifySlackSignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string | undefined
): SlackSignatureResult {
  if (!signingSecret) return webhookSecretRequired() ? { valid: false, reason: "not_configured" } : { valid: true };
  if (!signature || !timestamp) return { valid: false, reason: "missing" };

  const requestTimestamp = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTimestamp) > 60 * 5) return { valid: false, reason: "too_old" };

  const sigBasestring = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  // Constant-time compare: this check also gates Slack sign-in links (lib/slack-sign-in.ts).
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  const matches = given.length === want.length && timingSafeEqual(given, want);
  return matches ? { valid: true } : { valid: false, reason: "mismatch" };
}

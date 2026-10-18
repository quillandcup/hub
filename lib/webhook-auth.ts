import { createHash, timingSafeEqual } from "crypto";

/**
 * Whether a webhook whose signing secret or token isn't configured must reject every request.
 *
 * True on every deployed build (Vercel production and preview both run NODE_ENV=production):
 * a secret that was never set must not turn verification off, or anyone who finds the URL can
 * call the route. False for local `next dev` and tests, so webhooks can be exercised without
 * configuring each vendor's secret.
 */
export function webhookSecretRequired(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Constant-time comparison of a shared secret (e.g. a channel token) with what the request
 * sent. Both sides are hashed first so a different length doesn't return early.
 */
export function secretsMatch(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const want = createHash("sha256").update(expected).digest();
  const got = createHash("sha256").update(given).digest();
  return timingSafeEqual(want, got);
}

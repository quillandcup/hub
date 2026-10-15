import { EMAIL_FROM, isProduction } from "@/lib/config";
import { clock } from "@/lib/clock";

/**
 * Whether outbound emails sent via this module go to EMAIL_DEV_ADDRESS instead of their real
 * recipient. Same safe-by-default rule as Slack DMs (lib/slack.ts): unset EMAIL_TEST_MODE means
 * "redirect everywhere except production".
 */
export function isEmailTestMode(): boolean {
  if (process.env.EMAIL_TEST_MODE) return process.env.EMAIL_TEST_MODE === "true";
  return !isProduction;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative; mail clients and spam filters both like having one. */
  text: string;
  headers?: Record<string, string>;
}

const RESEND_URL = "https://api.resend.com/emails";
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 1000;

/**
 * Low-level email sender over Resend's HTTP API. Member notifications don't call this directly:
 * they go through createNotifier (lib/notifications/notify.ts), whose email channel uses it, so
 * they honor the member's notification settings. (Supabase Auth's own emails -- sign-in links,
 * invites -- are separate: Supabase renders and sends those itself; see supabase/emails/.)
 *
 * Resend's default limit is 2 requests/second and a batch of notifications can exceed it, so a 429
 * is retried (after the Retry-After it names) a couple of times. Any other failure, including a missing
 * RESEND_API_KEY or test mode without EMAIL_DEV_ADDRESS, throws (never a silent return, or callers
 * would report an email as sent); the notifier logs it and moves on to the member's other channels.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  let { to, subject } = params;
  if (isEmailTestMode()) {
    const devAddress = process.env.EMAIL_DEV_ADDRESS;
    if (!devAddress) {
      throw new Error("Email test mode is on but EMAIL_DEV_ADDRESS is unset, so nothing was sent rather than risk a real send");
    }
    subject = `🧪 [test mode — would have gone to ${to}] ${subject}`;
    to = devAddress;
  }

  const body = JSON.stringify({
    from: EMAIL_FROM,
    to: [to],
    subject,
    html: params.html,
    text: params.text,
    headers: params.headers,
  });

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    if (response.ok) return;

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await clock.sleep(retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_MS);
      continue;
    }
    throw new Error(`Resend responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

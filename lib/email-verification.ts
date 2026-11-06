import * as React from "react";
import { render } from "react-email";
import { createHmac, timingSafeEqual } from "crypto";
import { VerifyEmail } from "@/emails/account/VerifyEmail";
import { APP_URL } from "@/lib/config";
import { clock } from "@/lib/clock";
import { sendEmail } from "@/lib/email";
import type { EmailAliasDetail } from "@/lib/data/aliases";
import type { Repos } from "@/lib/data/repos";

type VerifyRepos = Pick<Repos, "aliases">;

/**
 * Proving an email alias is the member's: we send a signed link to the address, they open the page it
 * names and press the button, and the alias is marked verified (`member_email_aliases.verified_at`).
 * Only a verified alias can be made the primary email (`makeEmailPrimary`).
 *
 * The token names one alias and is signed over its id, its address and an expiry, so it cannot be used
 * for another alias, nor for the same alias after its address was changed. Format: `<aliasId>.<expiresAtSeconds>.<hmac>`.
 * It reuses `EMAIL_UNSUBSCRIBE_SECRET` under its own prefix (a signature made for one purpose is not valid for another),
 * which, like the unsubscribe links, must never be rotated while these are in mailboxes.
 *
 * This is a reply to something the member just did (adding an address), sent to that address rather than to
 * `members.email`, so it is sent directly and not through the notifier (CLAUDE.md, "Member Notifications").
 */

export const VERIFICATION_PATH = "/verify-email";
const TTL_MS = 7 * 24 * 3_600_000;
/** Shortest wait between two emails for one alias, so the resend button can't be used to mail an address repeatedly. */
export const RESEND_GAP_MS = 60_000;
export const VERIFICATION_SUBJECT = "Confirm your email address for Hedgie Hub";

function sign(aliasId: string, address: string, expiresAt: number): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("EMAIL_UNSUBSCRIBE_SECRET environment variable is not set");
  return createHmac("sha256", secret).update(`verify-email.${aliasId}.${address.toLowerCase()}.${expiresAt}`).digest("base64url");
}

export function signVerificationToken(aliasId: string, address: string): string {
  const expiresAt = Math.floor((clock.now() + TTL_MS) / 1000);
  return `${aliasId}.${expiresAt}.${sign(aliasId, address, expiresAt)}`;
}

export const verificationUrl = (token: string) => `${APP_URL}${VERIFICATION_PATH}?t=${token}`;

export type VerificationLookup =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "ready"; alias: EmailAliasDetail }
  | { state: "verified"; alias: EmailAliasDetail };

/** What a token from a link stands for now: not ours, too old, an alias waiting to be confirmed, or one already confirmed. */
export async function lookupVerificationToken(repos: VerifyRepos, token: string | null | undefined): Promise<VerificationLookup> {
  if (!token || !process.env.EMAIL_UNSUBSCRIBE_SECRET) return { state: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 3) return { state: "invalid" };
  const [aliasId, exp, signature] = parts;
  const expiresAt = Number(exp);
  if (!aliasId || !Number.isInteger(expiresAt)) return { state: "invalid" };

  const alias = await repos.aliases.emailById(aliasId).catch(() => null);
  if (!alias) return { state: "invalid" };
  const expected = Buffer.from(sign(aliasId, alias.aliasEmail, expiresAt));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { state: "invalid" };
  if (expiresAt * 1000 < clock.now()) return { state: "expired" };
  return { state: alias.verifiedAt ? "verified" : "ready", alias };
}

/** Marks the alias behind the token verified. Idempotent; the lookup it is based on is what proves the token. */
export async function confirmVerification(repos: VerifyRepos, token: string | null | undefined): Promise<VerificationLookup["state"]> {
  const found = await lookupVerificationToken(repos, token);
  if (found.state !== "ready") return found.state;
  const marked = await repos.aliases.markEmailVerified(found.alias.id, found.alias.aliasEmail);
  return marked ? "verified" : "invalid";
}

export async function renderVerificationEmail(address: string, verifyUrl: string) {
  const element = React.createElement(VerifyEmail, { address, verifyUrl });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: VERIFICATION_SUBJECT, html, text };
}

export type SendVerificationResult = { ok: true } | { ok: false; error: string };

/**
 * Emails the verification link for one of the member's own aliases. One email a minute per alias
 * (the claim is one conditional update, so two clicks send one). `repos` must be the service role's.
 */
export async function sendVerificationEmail(repos: VerifyRepos, memberId: string, aliasId: string): Promise<SendVerificationResult> {
  const alias = await repos.aliases.emailById(aliasId);
  if (!alias || alias.memberId !== memberId) return { ok: false, error: "That email isn't on your account." };
  if (alias.verifiedAt) return { ok: false, error: "That email is already confirmed." };
  if (!(await repos.aliases.claimVerificationSend(aliasId, RESEND_GAP_MS))) {
    return { ok: false, error: "We just sent that one. Check your inbox (and spam), or try again in a minute." };
  }

  try {
    const mail = await renderVerificationEmail(alias.aliasEmail, verificationUrl(signVerificationToken(alias.id, alias.aliasEmail)));
    await sendEmail({ to: alias.aliasEmail, ...mail, tags: { kind: "email_verification", member: memberId } });
    return { ok: true };
  } catch (error) {
    console.error("[email-verification] Sending the verification email failed:", error);
    return { ok: false, error: "Couldn't send the email. Try again in a minute." };
  }
}

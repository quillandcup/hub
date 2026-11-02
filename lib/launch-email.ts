import * as React from "react";
import { render } from "react-email";
import { LaunchEmail } from "@/emails/launch/LaunchEmail";
import { clock } from "@/lib/clock";
import { APP_URL } from "@/lib/config";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { MemberRepository } from "@/lib/data/members";
import { listAllAuthUsers, type AdminAuthApi, type AuthUserLite } from "@/lib/auth-provisioning";

/**
 * The launch-day "Hedgie Hub is open" email, sent in batches. For each active member whose account
 * is released (not banned), has not signed in and has not had this email, it asks Supabase Auth for a
 * fresh one-time code (`generateLink` sends nothing), emails it with Resend, and marks the user
 * (`app_metadata.launch_email_sent_at`) so a re-run never sends twice. The code is typed on
 * /login?mode=code; it is not in the link, so a mail scanner opening the link spends nothing.
 *
 * Why batches: members arrive over a few minutes instead of in one second, and Resend's free plan
 * allows 100 emails a day, so `limit` caps a run and a re-run carries on where it stopped.
 */

export const LAUNCH_SENT_MARK = "launch_email_sent_at";
export const LAUNCH_EMAIL_SUBJECT = "Hedgie Hub is open: sign in with your code";
export const LAUNCH_SIGN_IN_URL = `${APP_URL}/login?mode=code`;

export type LaunchAuthApi = AdminAuthApi & {
  generateLink(params: { type: "magiclink"; email: string }): Promise<{
    data: { properties: { email_otp?: string } | null } | null;
    error: { message: string } | null;
  }>;
};
export type LaunchUser = AuthUserLite & { last_sign_in_at?: string | null; app_metadata?: Record<string, unknown> | null };

export type LaunchSend = (mail: { to: string; subject: string; html: string; text: string }) => Promise<void>;

export type LaunchOptions = {
  apply: boolean;
  /** Send at most this many in this run. */
  limit?: number;
  /** Only this member's address (compared case-insensitively), when eligible; for a first send to one person. */
  onlyEmail?: string;
  batchSize?: number;
  /** Pause between batches, in milliseconds. */
  pauseMs?: number;
  now?: Date;
  /** Called per member as they are sent (or, in a dry run, would be), so a person running it sees who. */
  onRecipient?: (r: LaunchRecipient) => void;
};

export type LaunchRecipient = { memberId: string; name: string; email: string };

export type LaunchReport = {
  considered: number;
  sent: number;
  /** Would be sent, but `limit` was reached; the next run sends them. */
  deferred: number;
  alreadySent: number;
  alreadySignedIn: number;
  stillBanned: number;
  noAuthUser: number;
  failed: number;
  /** Ids only, never emails or names. */
  failedMemberIds: string[];
  /** Who was sent (or would be), in send order. Names and addresses: for the terminal, never for logs or commits. */
  recipients: LaunchRecipient[];
};

export async function renderLaunchEmail(code: string) {
  const element = React.createElement(LaunchEmail, { code, signInUrl: LAUNCH_SIGN_IN_URL });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: LAUNCH_EMAIL_SUBJECT, html, text };
}

const norm = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

export async function sendLaunchEmails(
  auth: LaunchAuthApi,
  members: Pick<MemberRepository, "list">,
  send: LaunchSend,
  options: LaunchOptions
): Promise<LaunchReport> {
  const { batchSize = 20, pauseMs = 60_000 } = options;
  const only = options.onlyEmail ? options.onlyEmail.trim().toLowerCase() : null;
  const now = (options.now ?? new Date()).getTime();
  const [active, users] = await Promise.all([members.list({ status: "active" }), listAllAuthUsers(auth)]);
  const byId = new Map<string, LaunchUser>();
  const byEmail = new Map<string, LaunchUser>();
  for (const u of users as LaunchUser[]) {
    byId.set(u.id, u);
    if (norm(u.email)) byEmail.set(norm(u.email), u);
  }

  const report: LaunchReport = { considered: 0, sent: 0, deferred: 0, alreadySent: 0, alreadySignedIn: 0, stillBanned: 0, noAuthUser: 0, failed: 0, failedMemberIds: [], recipients: [] };
  const noteRecipient = (member: (typeof active)[number], address: string) => {
    const r = { memberId: member.id, name: getMemberDisplayName({ name: member.name, display_name: member.displayName }), email: address };
    report.recipients.push(r);
    options.onRecipient?.(r);
  };
  let sentInBatch = 0;

  for (const member of active) {
    if (only && norm(member.email) !== only) continue;
    report.considered++;
    const email = norm(member.email);
    const user = (member.userId ? byId.get(member.userId) : undefined) ?? (email ? byEmail.get(email) : undefined);
    if (!user || !user.email) {
      report.noAuthUser++;
      continue;
    }
    if (user.app_metadata?.[LAUNCH_SENT_MARK]) {
      report.alreadySent++;
      continue;
    }
    if (user.last_sign_in_at) {
      report.alreadySignedIn++;
      continue;
    }
    if (user.banned_until && new Date(user.banned_until).getTime() > now) {
      report.stillBanned++;
      continue;
    }
    if (options.limit !== undefined && report.sent >= options.limit) {
      report.deferred++;
      continue;
    }
    if (!options.apply) {
      report.sent++;
      noteRecipient(member, user.email);
      continue;
    }

    if (sentInBatch >= batchSize) {
      await clock.sleep(pauseMs);
      sentInBatch = 0;
    }
    const { data, error } = await auth.generateLink({ type: "magiclink", email: user.email });
    const code = data?.properties?.email_otp;
    if (error || !code) {
      report.failed++;
      report.failedMemberIds.push(member.id);
      continue;
    }
    try {
      await send({ to: user.email, ...(await renderLaunchEmail(code)) });
    } catch (e) {
      // Resend's daily cap or an outage would fail every send after this one too: stop here, and
      // let a re-run (a later day, or after an upgrade) carry on rather than burn through the list.
      report.failed++;
      report.failedMemberIds.push(member.id);
      console.error("launch email: send failed, stopping:", e instanceof Error ? e.message : e);
      break;
    }
    const { error: markError } = await auth.updateUserById(user.id, { app_metadata: { [LAUNCH_SENT_MARK]: new Date(now).toISOString() } });
    if (markError) {
      report.failed++;
      report.failedMemberIds.push(member.id);
      continue;
    }
    report.sent++;
    sentInBatch++;
    noteRecipient(member, user.email);
  }
  return report;
}

import * as React from "react";
import { render } from "react-email";
import { LaunchEmail } from "@/emails/launch/LaunchEmail";
import { clock } from "@/lib/clock";
import { APP_URL } from "@/lib/config";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { AuthUser, AuthUserRepository } from "@/lib/data/auth-users";
import type { MemberRepository } from "@/lib/data/members";

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
/** The code leads the subject, the shape Gmail recognises as a verification code ("Copy code"). */
export const launchEmailSubject = (code: string) => `${code} is your Hedgie Hub verification code`;
export const LAUNCH_SIGN_IN_URL = `${APP_URL}/login?mode=code`;

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
  return { subject: launchEmailSubject(code), html, text };
}

const norm = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

export async function sendLaunchEmails(
  repos: { authUsers: AuthUserRepository; members: Pick<MemberRepository, "list"> },
  send: LaunchSend,
  options: LaunchOptions
): Promise<LaunchReport> {
  const { batchSize = 20, pauseMs = 60_000 } = options;
  const only = options.onlyEmail ? options.onlyEmail.trim().toLowerCase() : null;
  const now = (options.now ?? new Date()).getTime();
  const [active, users] = await Promise.all([repos.members.list({ status: "active" }), repos.authUsers.all()]);
  const byId = new Map<string, AuthUser>();
  const byEmail = new Map<string, AuthUser>();
  for (const u of users) {
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
    if (user.appMetadata[LAUNCH_SENT_MARK]) {
      report.alreadySent++;
      continue;
    }
    if (user.lastSignInAt) {
      report.alreadySignedIn++;
      continue;
    }
    if (user.bannedUntil && new Date(user.bannedUntil).getTime() > now) {
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
    let code: string;
    try {
      ({ code } = await repos.authUsers.generateMagicLink(user.id));
    } catch {
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
    try {
      await repos.authUsers.mergeAppMetadata(user.id, { [LAUNCH_SENT_MARK]: new Date(now).toISOString() });
    } catch {
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

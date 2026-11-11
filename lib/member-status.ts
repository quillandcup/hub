import type { Repos } from "@/lib/data/repos";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import { buildMembershipTimeline } from "@/lib/membership-timeline";

type MemberStatusRepos = Pick<Repos, "aliases" | "billing" | "memberStatus" | "members" | "programs">;

export type MemberStatus = "lead" | "active" | "on_hiatus" | "cancelled";

/**
 * A member's membership state at any instant, from the same history `recomputeMemberStatus` reads (the Membership
 * Timeline's engine, `buildMembershipTimeline`), so "was a member then" is derived, never assumed: a member on hiatus is
 * `on_hiatus`, not gone, and staff are always `active`. The history is read once; call `statusAt` for as many instants as
 * needed. Null when the member does not exist. Before a member's first stretch the answer is the same "lead" or
 * "cancelled" the cached column would give today (a past stint that ended reads "cancelled").
 */
export async function memberStatusTimeline(
  repos: MemberStatusRepos,
  memberId: string
): Promise<{ statusAt: (at: Date) => MemberStatus } | null> {
  const member = await repos.members.byId(memberId);
  if (!member) return null;

  // Staff are always active regardless of subscription/hiatus state (see reprocess_members_atomic's staff_role handling).
  if (member.staffRole) return { statusAt: () => "active" };

  const [emailAliasRows, hiatusRows, enrollments, overrideRows] = await Promise.all([
    repos.aliases.emailsOf(memberId),
    repos.memberStatus.hiatusesOf(memberId),
    repos.programs.enrollmentsOf(memberId),
    repos.memberStatus.statusOverridesOf(memberId),
  ]);

  const allEmails = [member.email, ...emailAliasRows.map((a) => a.alias_email)];
  const kajabiCustomers = await repos.billing.kajabiCustomers({ emails: allEmails });
  const customerIds = kajabiCustomers.map((c) => c.kajabi_customer_id).filter(Boolean);
  const membershipHistory = await fetchMembershipHistory(repos, customerIds);

  const programOverrides = enrollments.map((e) => ({
    id: e.id,
    starts_at: e.startsAt,
    expires_at: e.expiresAt,
    reason: e.programName,
  }));

  const segments = buildMembershipTimeline(membershipHistory, hiatusRows, programOverrides, overrideRows);
  return {
    statusAt(at) {
      const instant = at.getTime();
      const current = segments.find((s) => s.startDate.getTime() <= instant && (s.endDate === null || s.endDate.getTime() > instant));
      if (current?.state === "hiatus") return "on_hiatus";
      if (current?.state === "active") return "active";
      // A lapsed real subscription or a lapsed program-only enrollment both count as "was a member, left" (Step 4c)
      // rather than "never subscribed".
      return membershipHistory.length > 0 || programOverrides.length > 0 ? "cancelled" : "lead";
    },
  };
}

// members.status is a cached column, normally kept correct only by the full
// /api/process/members reprocess (reprocess_members_atomic). Admin actions
// that write directly to Local tables (member_hiatus_history,
// member_status_overrides) don't run that job, so without this the Status
// badge on the member detail page goes stale the moment a hiatus is
// started/ended/deleted through the UI (it shows "on hiatus" long after a
// "Return Early" has ended it, for example).
//
// This mirrors reprocess_members_atomic's priority (hiatus > active
// override/program > real Kajabi stint > lead/cancelled), but scoped to one
// member, by reusing buildMembershipTimeline — the same engine that already
// renders the live, correct Membership Timeline on that page — instead of
// duplicating its state-priority rules. Call after any write to hiatus/
// override/program-enrollment tables for a member so the cached column
// doesn't drift.
export async function recomputeMemberStatus(
  repos: MemberStatusRepos,
  memberId: string
): Promise<MemberStatus | null> {
  const member = await repos.members.byId(memberId);
  if (!member) return null;

  const timeline = await memberStatusTimeline(repos, memberId);
  if (!timeline) return null;
  const status = timeline.statusAt(new Date());

  if (member.status !== status) {
    await repos.members.setStatus(memberId, status).catch(() => {});
  }
  return status;
}

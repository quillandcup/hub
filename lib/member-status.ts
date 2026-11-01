import type { Repos } from "@/lib/data/repos";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import { buildMembershipTimeline } from "@/lib/membership-timeline";

type MemberStatusRepos = Pick<Repos, "aliases" | "billing" | "memberStatus" | "members" | "programs">;

export type MemberStatus = "lead" | "active" | "on_hiatus" | "cancelled";

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

  let status: MemberStatus;

  if (member.staffRole) {
    // Staff are always active regardless of subscription/hiatus state (see
    // reprocess_members_atomic's staff_role handling).
    status = "active";
  } else {
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
    const now = Date.now();
    const current = segments.find(
      (s) => s.startDate.getTime() <= now && (s.endDate === null || s.endDate.getTime() > now)
    );

    if (current?.state === "hiatus") status = "on_hiatus";
    else if (current?.state === "active") status = "active";
    // A lapsed real subscription or a lapsed program-only enrollment both
    // count as "was a member, left" (Step 4c) rather than "never subscribed".
    else status = membershipHistory.length > 0 || programOverrides.length > 0 ? "cancelled" : "lead";
  }

  if (member.status !== status) {
    await repos.members.setStatus(memberId, status).catch(() => {});
  }
  return status;
}

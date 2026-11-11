import {
  careWindows,
  type CareMembership,
  type CareResults,
  type CareTimes,
  type CareWindow,
  type CareWindowName,
  type CareWindowResult,
  type CareWindowSettings,
} from "@/lib/care";
import { ORG_TIMEZONE } from "@/lib/config";
import type { CareEngagementRow } from "@/lib/data/care";
import type { Repos } from "@/lib/data/repos";
import { memberStatusTimeline, type MemberStatus } from "@/lib/member-status";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";

type ResultRepos = Pick<Repos, "activities" | "memberInteractions" | "staff" | "members">;
/**
 * What the membership and program rows need: tables a community manager's own client may not read (status overrides, program
 * enrollments). The caller passes service-role repositories after checking who is asking; only the derived answer
 * (member, on hiatus, not a member, and program names) leaves this module.
 */
export type CarePrivilegedRepos = Pick<Repos, "aliases" | "billing" | "memberStatus" | "members" | "programs">;

/** Whether an instant falls in a window ([from, to)). */
function inWindow(iso: string | null, window: CareWindow): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return at >= Date.parse(window.from) && at < Date.parse(window.to);
}

/** An enrollment's start: a plain date is the start of that Eastern day, a timestamp is itself. */
function startInstant(startsAt: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(startsAt) ? zonedTimeToUtc(startsAt, "00:00", ORG_TIMEZONE).getTime() : Date.parse(startsAt);
}

const MEMBERSHIP_OF: Record<MemberStatus, CareMembership> = {
  active: "member",
  on_hiatus: "on_hiatus",
  cancelled: "not_a_member",
  lead: "not_a_member",
};

/**
 * Who does not count as "someone they connected with": every member who is staff, and the person who opened the
 * engagement (who may not be in the staff table at all: a community manager is paid in comps, with no contract).
 */
export async function careExcludedMemberIds(repos: Pick<Repos, "staff" | "members">, openedBy: string | null): Promise<Set<string>> {
  const [staff, opener] = await Promise.all([repos.staff.all(), openedBy ? repos.members.byUserId(openedBy) : Promise.resolve(null)]);
  const excluded = new Set<string>();
  for (const s of staff) if (s.member_id) excluded.add(s.member_id);
  if (opener) excluded.add(opener.id);
  return excluded;
}

/**
 * What the member did before, during and after an engagement, from their own activity (docs/HEDGIE_CARE.md, "Measuring
 * her influence"). Computed on request, never stored, so any window can be recomputed for any date. A window that has
 * not passed is counted up to now (during) or not at all (after, `counts: null`). These are descriptions, not proof the
 * outreach caused them.
 */
export async function loadCareResults(
  repos: ResultRepos,
  privileged: CarePrivilegedRepos,
  engagement: Pick<CareEngagementRow, "member_id" | "opened_by"> & CareTimes,
  now: Date,
  settings?: CareWindowSettings
): Promise<CareResults> {
  const windows = careWindows(engagement, now, settings);
  const names = Object.keys(windows) as CareWindowName[];
  const [excluded, firsts, timeline, enrollments] = await Promise.all([
    careExcludedMemberIds(repos, engagement.opened_by),
    repos.activities.firsts(engagement.member_id),
    memberStatusTimeline(privileged, engagement.member_id),
    privileged.programs.enrollmentsOf(engagement.member_id),
  ]);

  const result = async (window: CareWindow): Promise<CareWindowResult> => {
    if (window.state === "not_yet") return { window, counts: null };
    const [counts, counterparts] = await Promise.all([
      repos.activities.countsBetween(engagement.member_id, window.from, window.to),
      repos.memberInteractions.counterpartsBetween(engagement.member_id, window.from, window.to),
    ]);
    const lastInstant = new Date(Math.min(Date.parse(window.to) - 1, now.getTime()));
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    return {
      window,
      counts: {
        ...counts,
        firstPrickle: inWindow(firsts.firstPrickleAt, window),
        firstSlackPost: inWindow(firsts.firstSlackPostAt, window),
        peopleConnected: [...counterparts].filter((id) => !excluded.has(id)).length,
        membershipAtEnd: timeline ? MEMBERSHIP_OF[timeline.statusAt(lastInstant)] : "not_a_member",
        programsStarted: [...new Set(enrollments.filter((e) => startInstant(e.startsAt) >= from && startInstant(e.startsAt) < to).map((e) => e.programName))].sort(),
      },
    };
  };

  const results = await Promise.all(names.map((name) => result(windows[name])));
  return Object.fromEntries(names.map((name, i) => [name, results[i]])) as CareResults;
}

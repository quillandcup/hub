import {
  careCheckpoints,
  careWindows,
  commitmentLength,
  type CareCheckpoint,
  type CareFirstLapse,
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

/** A program's start and end as instants: a plain date is the start of that Eastern day. */
function programWindow(e: { startsAt: string; expiresAt: string }): [number, number] {
  return [startInstant(e.startsAt), startInstant(e.expiresAt)];
}

const MS_PER_DAY = 86_400_000;

/**
 * What the member did before, during and after an engagement, from their own activity, and how they stayed afterwards
 * (docs/HEDGIE_CARE.md, "Measuring her influence"). Computed on request, never stored, so any window can be recomputed for any
 * date. A window that has not passed is counted up to now (during) or not at all (after, `counts: null`); a retention
 * checkpoint that has not passed is `not_yet`. These are descriptions, not proof the outreach caused them.
 *
 * Retention is derived from membership history, never assumed: active, on hiatus (not the same as gone) or cancelled at each
 * checkpoint (`careRetentionCheckpointDays`), plus the first time after it opened that they went on hiatus or left, so a
 * day-31 lapse is visible even if they came back. Commitment is the programs they were enrolled in, with each cohort's own
 * length; a subscription's billing interval is not read (docs/TODO.md).
 */
export async function loadCareResults(
  repos: ResultRepos,
  privileged: CarePrivilegedRepos,
  engagement: Pick<CareEngagementRow, "member_id" | "opened_by"> & CareTimes,
  now: Date,
  settings?: CareWindowSettings,
  checkpointDays?: readonly number[]
): Promise<CareResults> {
  const windows = careWindows(engagement, now, settings);
  const names = Object.keys(windows) as CareWindowName[];
  const [excluded, firsts, timeline, enrollments] = await Promise.all([
    careExcludedMemberIds(repos, engagement.opened_by),
    repos.activities.firsts(engagement.member_id),
    memberStatusTimeline(privileged, engagement.member_id),
    privileged.programs.enrollmentsOf(engagement.member_id),
  ]);
  const programLabel = (e: { programName: string; startsAt: string; expiresAt: string }) => `${e.programName}, ${commitmentLength(e.startsAt, e.expiresAt)}`;

  const result = async (window: CareWindow): Promise<CareWindowResult> => {
    if (window.state === "not_yet") return { window, counts: null };
    const [counts, counterparts] = await Promise.all([
      repos.activities.countsBetween(engagement.member_id, window.from, window.to),
      repos.memberInteractions.counterpartsBetween(engagement.member_id, window.from, window.to),
    ]);
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    return {
      window,
      counts: {
        ...counts,
        firstPrickle: inWindow(firsts.firstPrickleAt, window),
        firstSlackPost: inWindow(firsts.firstSlackPostAt, window),
        peopleConnected: [...counterparts].filter((id) => !excluded.has(id)).length,
        programsStarted: [...new Set(enrollments.filter((e) => startInstant(e.startsAt) >= from && startInstant(e.startsAt) < to).map(programLabel))].sort(),
      },
    };
  };

  const checkpoint = (c: { days: number; at: Date; state: "complete" | "not_yet" }): CareCheckpoint => {
    if (c.state === "not_yet") return { days: c.days, at: c.at.toISOString(), state: c.state, membership: null, programs: null };
    const at = c.at.getTime();
    return {
      days: c.days,
      at: c.at.toISOString(),
      state: c.state,
      membership: timeline ? MEMBERSHIP_OF[timeline.statusAt(c.at)] : "not_a_member",
      programs: [...new Set(enrollments.filter((e) => programWindow(e)[0] <= at && at < programWindow(e)[1]).map(programLabel))].sort(),
    };
  };

  const opened = new Date(engagement.opened_at);
  const lapse = timeline?.firstLapse(opened, now) ?? null;
  const firstLapse: CareFirstLapse | null = lapse
    ? { status: lapse.status, at: lapse.at.toISOString(), daysAfterStart: Math.max(0, Math.floor((lapse.at.getTime() - opened.getTime()) / MS_PER_DAY)) }
    : null;

  const results = await Promise.all(names.map((name) => result(windows[name])));
  return {
    windows: Object.fromEntries(names.map((name, i) => [name, results[i]])) as CareResults["windows"],
    retention: { checkpoints: careCheckpoints(engagement, now, checkpointDays).map(checkpoint), firstLapse },
  };
}

import { careWindows, type CareResults, type CareTimes, type CareWindow, type CareWindowName, type CareWindowResult, type CareWindowSettings } from "@/lib/care";
import type { CareEngagementRow } from "@/lib/data/care";
import type { Repos } from "@/lib/data/repos";

type ResultRepos = Pick<Repos, "activities" | "memberInteractions" | "staff" | "members">;

/** Whether an instant falls in a window ([from, to)). */
function inWindow(iso: string | null, window: CareWindow): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return at >= Date.parse(window.from) && at < Date.parse(window.to);
}

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
 * not passed is counted up to now (during) or not at all (after, `counts: null`).
 */
export async function loadCareResults(
  repos: ResultRepos,
  engagement: Pick<CareEngagementRow, "member_id" | "opened_by"> & CareTimes,
  now: Date,
  settings?: CareWindowSettings
): Promise<CareResults> {
  const windows = careWindows(engagement, now, settings);
  const names = Object.keys(windows) as CareWindowName[];
  const [excluded, firsts] = await Promise.all([careExcludedMemberIds(repos, engagement.opened_by), repos.activities.firsts(engagement.member_id)]);

  const result = async (window: CareWindow): Promise<CareWindowResult> => {
    if (window.state === "not_yet") return { window, counts: null };
    const [counts, counterparts] = await Promise.all([
      repos.activities.countsBetween(engagement.member_id, window.from, window.to),
      repos.memberInteractions.counterpartsBetween(engagement.member_id, window.from, window.to),
    ]);
    return {
      window,
      counts: {
        ...counts,
        firstPrickle: inWindow(firsts.firstPrickleAt, window),
        firstSlackPost: inWindow(firsts.firstSlackPostAt, window),
        peopleConnected: [...counterparts].filter((id) => !excluded.has(id)).length,
      },
    };
  };

  const results = await Promise.all(names.map((name) => result(windows[name])));
  return Object.fromEntries(names.map((name, i) => [name, results[i]])) as CareResults;
}

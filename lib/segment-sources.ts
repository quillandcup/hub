import { clock } from "@/lib/clock";
import type { Repos } from "@/lib/data/repos";

type SourceRepos = Pick<Repos, "courses" | "courseProgress" | "programs" | "events">;

/** What a segment can be filled from: the people with access to a course, program or event. */
export const SEGMENT_SOURCE_TYPES = ["course", "program", "event"] as const;
export type SegmentSourceType = (typeof SEGMENT_SOURCE_TYPES)[number];

export interface SegmentSourceChoice {
  type: SegmentSourceType;
  id: string;
  name: string;
}

export function isSegmentSourceType(value: unknown): value is SegmentSourceType {
  return typeof value === "string" && (SEGMENT_SOURCE_TYPES as readonly string[]).includes(value);
}

/** Every course, program and event an admin can sync a segment from, for a picker. */
export async function segmentSourceChoices(repos: SourceRepos): Promise<SegmentSourceChoice[]> {
  const [courses, programs, events] = await Promise.all([repos.courses.courses(), repos.programs.names(), repos.events.choices()]);
  return [
    ...courses.map((c) => ({ type: "course" as const, id: c.id, name: c.title })),
    ...programs.map((p) => ({ type: "program" as const, id: p.id, name: p.name })),
    ...events.map((e) => ({ type: "event" as const, id: e.id, name: e.title })),
  ];
}

/**
 * The members who have access to the source right now, or null when there is no such course,
 * program or event: a course's open access rows (not ended), anyone enrolled in any cohort of a
 * program, an event's attendees.
 */
export async function memberIdsWithAccess(repos: SourceRepos, type: SegmentSourceType, id: string): Promise<string[] | null> {
  if (type === "course") {
    if (!(await repos.courses.courseById(id))) return null;
    const now = clock.now();
    const rows = await repos.courseProgress.accessOfCourses([id]);
    const open = rows.filter((r) => Date.parse(r.starts_at) <= now && (r.ends_at === null || Date.parse(r.ends_at) > now));
    return [...new Set(open.map((r) => r.member_id))];
  }
  if (type === "program") {
    if (!(await repos.programs.byId(id))) return null;
    const cohorts = await repos.programs.cohortsWithEnrollments(id);
    const ids = cohorts.flatMap((c) => c.member_program_enrollments.flatMap((e) => (e.member ? [e.member.id] : [])));
    return [...new Set(ids)];
  }
  if (!(await repos.events.byId(id))) return null;
  return [...new Set((await repos.events.attendeesOf(id)).map((a) => a.member_id))];
}

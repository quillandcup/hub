/**
 * Who's where in a course (docs/COURSES.md, "Admin course stats"): one row per member with access,
 * their progress through the open lessons and where they last were. Pure; the reads are in
 * `roster-data.ts`.
 */

export interface RosterAccess {
  memberId: string;
  startsAt: string;
  /** Null = lifetime. */
  endsAt: string | null;
  origin: "purchase" | "grant";
}

export interface RosterLesson {
  id: string;
  title: string;
  state: string;
}

export interface RosterProgress {
  memberId: string;
  lessonId: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface RosterRow {
  memberId: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  origin: "purchase" | "grant";
  /** Access has started and not ended. */
  accessActive: boolean;
  /** Open lessons completed. */
  completed: number;
  /** Open lessons in the course. */
  total: number;
  /** The lesson they last touched (progress row updated most recently), or null if none. */
  lastLessonId: string | null;
  lastLessonTitle: string | null;
  /** When they last touched any lesson. */
  lastActivityAt: string | null;
}

export function buildRoster(
  access: RosterAccess[],
  names: Map<string, string>,
  lessons: RosterLesson[],
  progress: RosterProgress[],
  now: Date
): RosterRow[] {
  const open = new Set(lessons.filter((l) => l.state === "open").map((l) => l.id));
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const byMember = new Map<string, RosterProgress[]>();
  for (const p of progress) {
    const list = byMember.get(p.memberId);
    if (list) list.push(p);
    else byMember.set(p.memberId, [p]);
  }
  return access.map((a) => {
    const mine = byMember.get(a.memberId) ?? [];
    let last: RosterProgress | null = null;
    for (const p of mine) if (!last || p.updatedAt > last.updatedAt) last = p;
    const lastLesson = last ? lessonById.get(last.lessonId) : undefined;
    return {
      memberId: a.memberId,
      name: names.get(a.memberId) ?? "Unknown member",
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      origin: a.origin,
      accessActive: new Date(a.startsAt) <= now && (!a.endsAt || new Date(a.endsAt) > now),
      completed: mine.filter((p) => p.completedAt && open.has(p.lessonId)).length,
      total: open.size,
      lastLessonId: lastLesson?.id ?? null,
      lastLessonTitle: lastLesson?.title ?? null,
      lastActivityAt: last?.updatedAt ?? null,
    };
  });
}

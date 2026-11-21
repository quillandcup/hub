import type { Db } from "@/lib/data/db";
import { asJson } from "@/lib/data/json";
import type { ZoomAttendeeRow, ZoomRepository } from "@/lib/data/zoom";

const MIN_PUP_DURATION_MS = 5 * 60 * 1000;
const MIN_PUP_ATTENDEES = 2;

export interface PupRecord {
  client_prickle_id: string;
  start_time: string;
  end_time: string;
  [key: string]: unknown;
}

export interface AttendanceRecord {
  client_prickle_id: string | null;
  member_id: string;
  [key: string]: unknown;
}

/** A Pop-Up Prickle as `reprocess_prickle_attendance_atomic` reads it from its `new_pup_data` argument. */
export interface PupInput extends PupRecord {
  /** Names the PUP within one call, so attendance rows can point at it before it has a database id. */
  client_prickle_id: string;
  type_id: string;
  host: string | null;
  source: "zoom";
  zoom_meeting_uuid: string;
}

/** An attendance row as the same function reads it from `new_attendance_data`: a real `prickle_id`, or a `client_prickle_id` naming one of the PUPs in the call. */
export interface AttendanceInput extends AttendanceRecord {
  prickle_id: string | null;
  client_prickle_id: string | null;
  member_id: string;
  join_time: string;
  leave_time: string;
  confidence_score: string;
}

/**
 * Replace the attendance and Pop-Up Prickles that overlap [from, to) with these, in one transaction
 * (it also rebuilds the range's `member_activities` mirror). PUPs left out are deleted; ones that
 * match on meeting and times keep their ids. Throws on a database error.
 */
export async function reprocessAttendanceRange(
  db: Db,
  range: { from: string; to: string; pups: PupInput[]; attendance: AttendanceInput[] }
): Promise<void> {
  const { error } = await db.rpc("reprocess_prickle_attendance_atomic", {
    from_date: range.from,
    to_date: range.to,
    new_pup_data: asJson(range.pups),
    new_attendance_data: asJson(range.attendance),
  });
  if (error) throw error;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instants to reprocess for an import asked for `fromDate` to `toDate`. A date alone
 * ("2026-11-04") names a whole UTC day, so a date-only `toDate` ends at the start of the next day
 * (the attendance route reads a date-only `toDate` the same way). Taken as the day's first
 * instant it left a same-day import with a zero-width range, which saw only the people in the
 * room at midnight UTC (19:00 Eastern in winter) and no prickle starting after it. Anything
 * with a time in it is that instant.
 */
export function importReprocessRange(fromDate: string, toDate: string): { from: Date; to: Date } {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (DATE_ONLY.test(toDate)) to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

/** The key the attendance run groups a Zoom row by: its meeting's uuid, else its meeting id. */
export const sessionKey = (a: Pick<ZoomAttendeeRow, "meeting_uuid" | "meeting_id">): string => a.meeting_uuid || a.meeting_id;

/** How far a run's range may be widened to take in whole meetings; a row that asks for more is bad data, not a meeting. */
const MAX_WIDENING_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_WIDENING_ROUNDS = 10;

/**
 * The attendees of every meeting that overlaps [from, to), whole, and the range widened to cover
 * them. A run is asked for a date range, but a Pop-Up Prickle's start and end, the scheduled
 * prickles it sits between and the attendance written for it all come from the whole meeting:
 * a range that ends mid-meeting (a date that stops at midnight UTC, a window around one changed
 * calendar event) used to show the run only some of the people, and no prickle starting after it, so it
 * built a different Pop-Up Prickle (under a new id) from the one a full run builds. Widening
 * repeats until no meeting overlapping the range reaches outside it, so the range can be used
 * for everything else the run reads and deletes. Nothing overlaps: the range comes back as asked.
 */
export async function loadWholeMeetings(
  zoom: Pick<ZoomRepository, "attendeesOverlapping" | "attendeesOfSessions">,
  range: { from: string; to: string }
): Promise<{ from: string; to: string; attendees: ZoomAttendeeRow[] }> {
  const askedFrom = new Date(range.from).getTime();
  const askedTo = new Date(range.to).getTime();
  let from = askedFrom;
  let to = askedTo;
  for (let round = 0; round < MAX_WIDENING_ROUNDS; round++) {
    const visible = await zoom.attendeesOverlapping(new Date(from).toISOString(), new Date(to).toISOString());
    if (visible.length === 0) return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), attendees: [] };

    // Only a meeting with a row near an edge of the range can have rows outside it (a meeting's rows
    // are hours apart, the margin is days), so a long range reads just its edges' meetings again.
    const edgeKeys = new Set(
      visible
        .filter((a) => new Date(a.join_time).getTime() < from + MAX_WIDENING_MS || new Date(a.leave_time).getTime() > to - MAX_WIDENING_MS)
        .map(sessionKey)
    );
    const whole = edgeKeys.size > 0 ? await zoom.attendeesOfSessions([...edgeKeys]) : [];
    const byId = new Map([...visible, ...whole].map((a) => [a.id, a]));
    const attendees = [...byId.values()].sort((a, b) => (a.join_time < b.join_time ? -1 : a.join_time > b.join_time ? 1 : a.id < b.id ? -1 : 1));
    let nextFrom = from;
    let nextTo = to;
    for (const a of attendees) {
      nextFrom = Math.min(nextFrom, new Date(a.join_time).getTime());
      nextTo = Math.max(nextTo, new Date(a.leave_time).getTime());
    }
    if (nextFrom === from && nextTo === to) return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), attendees };
    if (askedFrom - nextFrom > MAX_WIDENING_MS || nextTo - askedTo > MAX_WIDENING_MS) {
      throw new Error(`Zoom meetings overlapping ${range.from} to ${range.to} reach more than 3 days outside it (${new Date(nextFrom).toISOString()} to ${new Date(nextTo).toISOString()}); check their join and leave times`);
    }
    from = nextFrom;
    to = nextTo;
  }
  throw new Error(`Zoom meetings overlapping ${range.from} to ${range.to} still reached outside the range after ${MAX_WIDENING_ROUNDS} widenings`);
}

/** Remember that a Zoom name matched several members (`count` replaces its occurrences, so reprocessing doesn't inflate it). Throws on a database error. */
export async function trackAmbiguousZoomName(
  db: Db,
  name: string,
  email: string | null,
  candidateMemberIds: string[],
  count: number
): Promise<void> {
  const { error } = await db.rpc("upsert_ambiguous_zoom_name", {
    p_zoom_name: name,
    // null is allowed: the function stores it as no email, but the generated type wants a string
    p_zoom_email: email as string,
    p_candidate_member_ids: candidateMemberIds,
    p_occurrence_increment: count,
  });
  if (error) throw error;
}

/**
 * Remove PUPs that are both short (<5 min) and solo (1 unique attendee).
 * A Zoom session with one person for under 5 minutes is not a real prickle.
 */
export function filterTrivialPups<P extends PupRecord, A extends AttendanceRecord>(
  pupsToCreate: P[],
  attendanceToUpsert: A[]
): { filteredPups: P[]; filteredAttendance: A[]; removedCount: number } {
  const trivialIds = new Set<string>();

  for (const pup of pupsToCreate) {
    const duration = new Date(pup.end_time).getTime() - new Date(pup.start_time).getTime();
    if (duration >= MIN_PUP_DURATION_MS) continue;

    const uniqueMembers = new Set(
      attendanceToUpsert
        .filter(a => a.client_prickle_id === pup.client_prickle_id)
        .map(a => a.member_id)
    ).size;

    if (uniqueMembers < MIN_PUP_ATTENDEES) {
      trivialIds.add(pup.client_prickle_id);
    }
  }

  return {
    filteredPups: pupsToCreate.filter(p => !trivialIds.has(p.client_prickle_id)),
    filteredAttendance: attendanceToUpsert.filter(
      a => a.client_prickle_id === null || !trivialIds.has(a.client_prickle_id)
    ),
    removedCount: trivialIds.size,
  };
}

export interface TimeSpan {
  start: string;
  end: string;
}

export interface AttendanceWriteChunk<P, A> {
  from: string;
  to: string;
  pups: P[];
  attendance: A[];
}

/**
 * Split one reprocess_prickle_attendance_atomic call into several smaller ones,
 * each of which still fits Postgres's statement timeout. A 90-day rewrite in a
 * single call (2,000+ attendance rows plus the member_activities mirror) didn't.
 *
 * The rows are computed once for the whole range; only the writes are split.
 * That's only safe if every chunk's DELETEs stay inside the chunk: the function
 * deletes attendance and PUPs that *overlap* [from, to), and the
 * member_activities mirror is rebuilt per prickle. So chunk edges are placed
 * only in quiet gaps, where no Zoom session, calendar prickle or PUP is in
 * progress (`busy` lists all of them). Then no row or prickle crosses an edge,
 * and the chunks write exactly what one call would have. With no quiet gap
 * inside the range, everything stays in one chunk.
 *
 * Each chunk is atomic on its own; if a later chunk fails, earlier chunks
 * already hold fresh data and the rest keep their previous, consistent rows.
 */
export function chunkAttendanceWrites<
  P extends { start_time: string },
  A extends { join_time: string }
>(
  from: string,
  to: string,
  busy: TimeSpan[],
  pups: P[],
  attendance: A[],
  maxRowsPerChunk: number
): AttendanceWriteChunk<P, A>[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  // Merge busy spans into blocks separated by quiet gaps.
  const spans = busy
    .map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end) }))
    .filter((s) => s.end > fromMs && s.start < toMs)
    .sort((a, b) => a.start - b.start);
  const blocks: { start: number; end: number; rows: number }[] = [];
  for (const s of spans) {
    const last = blocks[blocks.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else blocks.push({ start: s.start, end: s.end, rows: 0 });
  }

  // Count the rows that start in each block, to size chunks.
  const blockIndexAt = (ms: number) => {
    let lo = 0;
    let hi = blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].start <= ms) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  for (const row of [...pups.map((p) => p.start_time), ...attendance.map((a) => a.join_time)]) {
    const i = blockIndexAt(Date.parse(row));
    if (i >= 0) blocks[i].rows++;
  }

  // Cut in the middle of a quiet gap whenever adding the next block would
  // overflow the current chunk.
  const edges: number[] = [];
  let rowsInChunk = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0 && rowsInChunk > 0 && rowsInChunk + blocks[i].rows > maxRowsPerChunk) {
      const edge = Math.floor((blocks[i - 1].end + blocks[i].start) / 2);
      if (edge > fromMs && edge < toMs) {
        edges.push(edge);
        rowsInChunk = 0;
      }
    }
    rowsInChunk += blocks[i].rows;
  }

  const bounds = [fromMs, ...edges, toMs];
  const chunks: AttendanceWriteChunk<P, A>[] = bounds.slice(0, -1).map((start, i) => ({
    from: i === 0 ? from : new Date(start).toISOString(),
    to: i === bounds.length - 2 ? to : new Date(bounds[i + 1]).toISOString(),
    pups: [],
    attendance: [],
  }));
  const chunkIndexAt = (ms: number) => {
    let i = 0;
    while (i < edges.length && ms >= edges[i]) i++;
    return i;
  };
  for (const pup of pups) chunks[chunkIndexAt(Date.parse(pup.start_time))].pups.push(pup);
  for (const row of attendance) chunks[chunkIndexAt(Date.parse(row.join_time))].attendance.push(row);
  return chunks;
}

/**
 * Whether reprocessing members changed anything attendance matching reads
 * (matchAttendeeToMember uses each member's id, name and email). If not, the
 * 90-day attendance rebuild after a member reprocess would recompute the same
 * rows, so it's skipped.
 */
export function attendanceMatchInputsChanged(
  before: { id: string; name?: string | null; email?: string | null }[],
  after: { id: string; name?: string | null; email?: string | null }[]
): boolean {
  const key = (m: { id: string; name?: string | null; email?: string | null }) =>
    `${m.id}\u0000${m.name ?? ""}\u0000${m.email ?? ""}`;
  if (before.length !== after.length) return true;
  const beforeKeys = new Set(before.map(key));
  return after.some((m) => !beforeKeys.has(key(m)));
}

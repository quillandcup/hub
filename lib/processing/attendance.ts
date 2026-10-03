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

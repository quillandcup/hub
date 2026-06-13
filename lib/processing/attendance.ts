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

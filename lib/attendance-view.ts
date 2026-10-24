import type { AttendedPrickle, Attendee } from "@/lib/data/attendance";
import type { AttRow } from "@/lib/community-stats";

/**
 * Attendance in the snake_case row shapes the attendance tables and calendars were written
 * against (`PrickleDetails`, `MemberAttendanceView`, `MemberCalendarClient`, community stats).
 * Pages read domain objects from the attendance repository and hand these to those components;
 * retire a function when its component takes the domain type directly.
 */

/** A prickle's attendee row: the member's id and name, and their email only when the repository was asked for it. */
export function attendeeRow(a: Attendee) {
  return {
    id: a.id,
    join_time: a.joinTime,
    leave_time: a.leaveTime,
    confidence_score: a.confidenceScore,
    member_id: a.memberId,
    members: a.name === null ? null : { id: a.memberId, name: a.name, ...(a.email === null ? {} : { email: a.email }) },
  };
}

/** One of a member's attendance records, with the prickle (host, type) it was at. */
export function attendedPrickleRow(a: AttendedPrickle) {
  const p = a.prickle;
  return {
    id: a.id,
    join_time: a.joinTime,
    leave_time: a.leaveTime,
    confidence_score: a.confidenceScore,
    prickles: p
      ? {
          id: p.id,
          host: p.host ? { id: p.host.id, name: p.host.name } : null,
          start_time: p.startTime,
          end_time: p.endTime,
          prickle_types: p.type ? { name: p.type.name } : null,
        }
      : null,
  };
}

/** A community-stats attendance row. */
export function statsAttendanceRow(a: Attendee): AttRow {
  return {
    member_id: a.memberId,
    prickle_id: a.prickleId,
    join_time: a.joinTime,
    leave_time: a.leaveTime,
    members: a.name === null ? null : { name: a.name },
  };
}

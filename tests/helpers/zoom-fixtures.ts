import type { ZoomAttendeeRow } from "@/lib/data/zoom";

let n = 0;

/** A Bronze Zoom attendee row for an in-memory dataset; only what a test cares about needs saying. */
export function zoomAttendee(fields: Partial<ZoomAttendeeRow> & Pick<ZoomAttendeeRow, "name">): ZoomAttendeeRow {
  n += 1;
  return {
    id: `zat-${String(n).padStart(6, "0")}`,
    attentiveness_score: null,
    created_at: null,
    duration: 30,
    email: null,
    failover: null,
    join_time: "2026-10-01T15:00:00Z",
    leave_time: "2026-10-01T15:30:00Z",
    meeting_id: "1",
    meeting_uuid: null,
    participant_id: null,
    raw_payload: null,
    registrant_id: null,
    status: null,
    topic: null,
    user_id: null,
    ...fields,
  };
}

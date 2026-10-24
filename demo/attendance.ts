/**
 * Who came to which prickle, as Zoom would have recorded it, so the demo's schedule, streaks, host stats and
 * history look lived in. These are Bronze rows (bronze.zoom_attendees); the app's own `/api/process/attendance`
 * turns them into attendance, the way production does.
 *
 * Deterministic: a hash of the prickle and the person decides everything (who comes, when they join, who
 * leaves early), so a reseed makes the same crowd, and a test can say exactly what the output is.
 */

export interface PrickleSlot {
  key: string;
  summary: string;
  start: Date;
  end: Date;
}

export interface Attendee {
  name: string;
  email: string;
  joinedAt: Date;
  /** Chance (0 to 1) of coming to a prickle they could attend. */
  rate: number;
}

export interface ZoomAttendeeRow {
  meeting_id: string;
  meeting_uuid: string;
  topic: string;
  participant_id: string;
  name: string;
  email: string;
  join_time: string;
  leave_time: string;
  duration: number;
  status: string;
  raw_payload: { demo: true };
}

/** FNV-1a, mapped to [0, 1). Stable across runs and machines. */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

const MINUTE = 60_000;
/** The topic every demo row carries, so the seed can find and replace its own rows and nothing else. */
export const DEMO_TOPIC_PREFIX = "Demo:";

function row(slot: PrickleSlot, person: { name: string; email: string }, meetingId: string, join: Date, leave: Date): ZoomAttendeeRow {
  return {
    meeting_id: meetingId,
    meeting_uuid: `demo-mtg-${slot.key}`,
    topic: `${DEMO_TOPIC_PREFIX} ${slot.summary}`,
    participant_id: `demo-${person.email}`,
    name: person.name,
    email: person.email,
    join_time: join.toISOString(),
    leave_time: leave.toISOString(),
    duration: Math.round((leave.getTime() - join.getTime()) / 1000),
    status: "in_meeting",
    raw_payload: { demo: true },
  };
}

/** The host named in a calendar title ("Progress Prickle w/Hazel Hosting"), or null for a prickle without one. */
export function hostOf(summary: string): string | null {
  return /\bw\/\s*(.+?)\s*$/i.exec(summary)?.[1] ?? null;
}

/**
 * Attendance rows for every prickle that has ended by `now`. The named host comes a couple of minutes early
 * and stays to the end; everyone else comes with their own probability, joins up to eight minutes in, now and
 * then leaves early or steps out and back (two rows, as the app expects). Nobody attends before they joined.
 */
export function attendanceRows(slots: PrickleSlot[], people: Attendee[], now: Date, meetingId: string): ZoomAttendeeRow[] {
  const rows: ZoomAttendeeRow[] = [];
  for (const slot of slots) {
    if (slot.end.getTime() > now.getTime()) continue;
    const host = hostOf(slot.summary);
    for (const person of people) {
      const isHost = host !== null && person.name === host;
      if (!isHost && (person.joinedAt.getTime() > slot.start.getTime() || hash01(`${slot.key}|${person.email}`) >= person.rate)) continue;

      if (isHost) {
        const early = (1 + Math.floor(hash01(`${slot.key}|${person.email}|early`) * 3)) * MINUTE;
        rows.push(row(slot, person, meetingId, new Date(slot.start.getTime() - early), new Date(slot.end.getTime() + MINUTE)));
        continue;
      }

      const joinAt = new Date(slot.start.getTime() + Math.floor(hash01(`${slot.key}|${person.email}|join`) * 9) * MINUTE);
      const roll = hash01(`${slot.key}|${person.email}|shape`);
      if (roll < 0.15) {
        // Leaves early, 5 to 20 minutes before the end.
        const leaveAt = new Date(slot.end.getTime() - (5 + Math.floor(hash01(`${slot.key}|${person.email}|early`) * 16)) * MINUTE);
        if (leaveAt.getTime() > joinAt.getTime()) rows.push(row(slot, person, meetingId, joinAt, leaveAt));
      } else if (roll < 0.25) {
        // Steps out for a few minutes in the middle and comes back: one prickle, two attendance rows.
        const middle = new Date((slot.start.getTime() + slot.end.getTime()) / 2);
        const back = new Date(middle.getTime() + 4 * MINUTE);
        if (middle.getTime() > joinAt.getTime()) {
          rows.push(row(slot, person, meetingId, joinAt, middle));
          rows.push(row(slot, person, meetingId, back, new Date(slot.end.getTime() + MINUTE)));
        }
      } else {
        rows.push(row(slot, person, meetingId, joinAt, new Date(slot.end.getTime() + MINUTE)));
      }
    }
  }
  return rows;
}

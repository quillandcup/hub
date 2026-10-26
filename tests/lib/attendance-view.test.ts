import { describe, expect, it } from "vitest";
import { attendedPrickleRow, attendeeRow, statsAttendanceRow } from "@/lib/attendance-view";
import type { AttendedPrickle, Attendee } from "@/lib/data/attendance";

const attendee: Attendee = {
  id: "att-1",
  memberId: "mbr_AAAAAAAAAAA1",
  prickleId: "prkl_AAAAAAAAAAA1",
  joinTime: "2026-10-20T15:00:00Z",
  leaveTime: "2026-10-20T16:00:00Z",
  confidenceScore: "high",
  name: "Ada Example",
  displayName: null,
  email: null,
};

describe("attendance view rows", () => {
  it("gives an attendee row the member's id and name, and an email only when there is one", () => {
    expect(attendeeRow(attendee).members).toEqual({ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" });
    expect(attendeeRow({ ...attendee, email: "ada@example.test" }).members).toEqual({
      id: "mbr_AAAAAAAAAAA1",
      name: "Ada Example",
      email: "ada@example.test",
    });
    expect(attendeeRow(attendee)).toMatchObject({ id: "att-1", member_id: "mbr_AAAAAAAAAAA1", join_time: "2026-10-20T15:00:00Z", confidence_score: "high" });
  });

  it("leaves the member out when the attendee's name is hidden", () => {
    expect(attendeeRow({ ...attendee, name: null }).members).toBeNull();
    expect(statsAttendanceRow({ ...attendee, name: null }).members).toBeNull();
  });

  it("maps a stats row", () => {
    expect(statsAttendanceRow(attendee)).toEqual({
      member_id: "mbr_AAAAAAAAAAA1",
      prickle_id: "prkl_AAAAAAAAAAA1",
      join_time: "2026-10-20T15:00:00Z",
      leave_time: "2026-10-20T16:00:00Z",
      members: { name: "Ada Example" },
    });
  });

  it("maps a member's attendance with the prickle's host and type, tolerating a missing host, type or prickle", () => {
    const record: AttendedPrickle = {
      id: "att-1",
      prickleId: "prkl_AAAAAAAAAAA1",
      joinTime: "2026-10-20T15:00:00Z",
      leaveTime: "2026-10-20T16:00:00Z",
      confidenceScore: "high",
      prickle: {
        id: "prkl_AAAAAAAAAAA1",
        typeId: "ptyp_AAAAAAAAAAA1",
        hostId: "mbr_AAAAAAAAAAA2",
        title: null,
        startTime: "2026-10-20T15:00:00Z",
        endTime: "2026-10-20T16:00:00Z",
        source: "calendar",
        calendarEventId: null,
        type: { id: "ptyp_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, isSpecialty: false },
        host: { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", displayName: "Fern" },
      },
    };

    expect(attendedPrickleRow(record).prickles).toEqual({
      id: "prkl_AAAAAAAAAAA1",
      host: { id: "mbr_AAAAAAAAAAA2", name: "Fern Example" },
      start_time: "2026-10-20T15:00:00Z",
      end_time: "2026-10-20T16:00:00Z",
      prickle_types: { name: "Sprint" },
    });
    expect(attendedPrickleRow({ ...record, prickle: { ...record.prickle!, host: null, type: null } }).prickles).toMatchObject({ host: null, prickle_types: null });
    expect(attendedPrickleRow({ ...record, prickle: null }).prickles).toBeNull();
  });
});

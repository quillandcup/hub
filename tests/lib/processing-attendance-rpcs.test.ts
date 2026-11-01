import { describe, it, expect, vi } from "vitest";
import type { Db } from "@/lib/data/db";
import {
  reprocessAttendanceRange,
  trackAmbiguousZoomName,
  type AttendanceInput,
  type PupInput,
} from "@/lib/processing/attendance";

const dbWith = (result: { error: unknown }) => {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as Db, rpc };
};

const pup: PupInput = {
  client_prickle_id: "pup_0",
  type_id: "prty_AAAAAAAAAAA1",
  host: null,
  start_time: "2026-10-19T15:00:00Z",
  end_time: "2026-10-19T16:00:00Z",
  source: "zoom",
  zoom_meeting_uuid: "meeting-1",
};
const attendance: AttendanceInput = {
  prickle_id: null,
  client_prickle_id: "pup_0",
  member_id: "mbr_AAAAAAAAAAA1",
  join_time: "2026-10-19T15:02:00Z",
  leave_time: "2026-10-19T16:00:00Z",
  confidence_score: "high",
};

describe("reprocessAttendanceRange", () => {
  it("replaces the range's attendance and Pop-Up Prickles in one call", async () => {
    const { db, rpc } = dbWith({ error: null });

    await reprocessAttendanceRange(db, { from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z", pups: [pup], attendance: [attendance] });

    expect(rpc).toHaveBeenCalledWith("reprocess_prickle_attendance_atomic", {
      from_date: "2026-10-19T00:00:00Z",
      to_date: "2026-10-20T00:00:00Z",
      new_pup_data: [pup],
      new_attendance_data: [attendance],
    });
  });

  it("sends empty arrays to clear a range with nothing in it", async () => {
    const { db, rpc } = dbWith({ error: null });

    await reprocessAttendanceRange(db, { from: "a", to: "b", pups: [], attendance: [] });

    expect(rpc).toHaveBeenCalledWith("reprocess_prickle_attendance_atomic", { from_date: "a", to_date: "b", new_pup_data: [], new_attendance_data: [] });
  });

  it("throws the database error", async () => {
    const { db } = dbWith({ error: new Error("statement timeout") });

    await expect(reprocessAttendanceRange(db, { from: "a", to: "b", pups: [], attendance: [] })).rejects.toThrow("statement timeout");
  });
});

describe("trackAmbiguousZoomName", () => {
  it("records the name with its candidates and how often it appeared", async () => {
    const { db, rpc } = dbWith({ error: null });

    await trackAmbiguousZoomName(db, "Ada E", "ada@example.test", ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"], 3);

    expect(rpc).toHaveBeenCalledWith("upsert_ambiguous_zoom_name", {
      p_zoom_name: "Ada E",
      p_zoom_email: "ada@example.test",
      p_candidate_member_ids: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
      p_occurrence_increment: 3,
    });
  });

  it("sends a missing email as null, and throws the database error", async () => {
    const ok = dbWith({ error: null });
    await trackAmbiguousZoomName(ok.db, "Ada E", null, [], 1);
    expect(ok.rpc).toHaveBeenCalledWith("upsert_ambiguous_zoom_name", expect.objectContaining({ p_zoom_email: null }));

    const failing = dbWith({ error: new Error("boom") });
    await expect(trackAmbiguousZoomName(failing.db, "Ada E", null, [], 1)).rejects.toThrow("boom");
  });
});

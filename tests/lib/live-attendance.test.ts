import { describe, it, expect } from "vitest";
import { loadLiveAttendance } from "@/lib/live-attendance";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00.000Z`).getTime();
const iso = (hhmm: string) => new Date(t(hhmm)).toISOString();

const ev = (id: string, key: string, name: string, event: string, hhmm: string) => ({
  id,
  meeting_uuid: "mtg-1",
  meeting_id: null,
  host_id: "host-1",
  participant_key: key,
  participant_name: name,
  participant_email: null,
  event,
  event_time: iso(hhmm),
  leave_reason: null,
  raw_payload: {},
  received_at: iso(hhmm),
});

const meeting = {
  id: "z1",
  meeting_id: "z1",
  meeting_uuid: "z1",
  topic: "Prickle",
  start_time: iso("10:00"),
  end_time: null,
  duration_minutes: null,
  host_email: null,
  host_name: null,
  participant_count: null,
  imported_at: null,
  updated_at: null,
  data: { host_id: "host-1" },
};

const repos = (events: ReturnType<typeof ev>[]) =>
  createInMemoryRepos(
    new InMemoryDataset({
      zoomParticipantEvents: events,
      zoomMeetings: [meeting],
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" },
        { id: "mbr_AAAAAAAAAAA2", name: "Bea Example", email: "bea@example.test" },
      ],
    })
  );

const running = { id: "prkl_AAAAAAAAAAA1", startTime: iso("11:00"), endTime: iso("12:00") };

describe("loadLiveAttendance", () => {
  it("counts members in the room of a running prickle, dated from their join", async () => {
    const live = await loadLiveAttendance(
      repos([ev("1", "d1", "Ada Example", "joined", "11:05"), ev("2", "d2", "Bea Example", "joined", "11:10"), ev("3", "d2", "Bea Example", "left", "11:20")]),
      [running],
      new Date(t("11:30"))
    );
    expect(live.get(running.id)).toEqual([
      { memberId: "mbr_AAAAAAAAAAA1", joinTime: iso("11:05"), leaveTime: null },
      { memberId: "mbr_AAAAAAAAAAA2", joinTime: iso("11:10"), leaveTime: iso("11:20") },
    ]);
  });

  it("dates someone who was already in the room from the prickle's start", async () => {
    const live = await loadLiveAttendance(repos([ev("1", "d1", "Ada Example", "joined", "10:50")]), [running], new Date(t("11:30")));
    expect(live.get(running.id)).toEqual([{ memberId: "mbr_AAAAAAAAAAA1", joinTime: iso("11:00"), leaveTime: null }]);
  });

  it("leaves out guests who are not members", async () => {
    const live = await loadLiveAttendance(repos([ev("1", "d9", "Nobody Known", "joined", "11:05")]), [running], new Date(t("11:30")));
    expect(live.size).toBe(0);
  });

  it("does not count a few minutes of lingering into the next prickle", async () => {
    const next = { id: "prkl_AAAAAAAAAAA2", startTime: iso("12:00"), endTime: iso("13:00") };
    const live = await loadLiveAttendance(
      repos([ev("1", "d1", "Ada Example", "joined", "11:00"), ev("2", "d1", "Ada Example", "left", "12:03")]),
      [running, next],
      new Date(t("12:30"))
    );
    expect(live.get(running.id)).toHaveLength(1);
    expect(live.has(next.id)).toBe(false);
  });

  it("ignores prickles that have not started or ended long ago, without reading presence", async () => {
    const future = { id: "prkl_AAAAAAAAAAA3", startTime: iso("14:00"), endTime: iso("15:00") };
    const old = { id: "prkl_AAAAAAAAAAA4", startTime: "2026-10-01T11:00:00.000Z", endTime: "2026-10-01T12:00:00.000Z" };
    const live = await loadLiveAttendance(repos([ev("1", "d1", "Ada Example", "joined", "11:05")]), [future, old], new Date(t("11:30")));
    expect(live.size).toBe(0);
  });
});

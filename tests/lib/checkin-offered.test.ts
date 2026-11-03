import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import {
  CHECKIN_SOON_MS,
  IN_PROGRESS_LOOKBACK_MS,
  PRIORITY,
  checkinOffered,
  getCheckinPrickles,
  markPresent,
  type HighlightReason,
  type RankedPrickle,
} from "@/lib/upcoming-prickles";

const HOUR = 60 * 60 * 1000;
const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00.000Z`).getTime();
const iso = (hhmm: string) => new Date(t(hhmm)).toISOString();
const NOW = new Date(iso("11:30"));
const TIED: HighlightReason[] = [{ kind: "commitment", tooltip: ["Week 1 of 4"] }];
const running = { startTime: iso("11:00"), endTime: iso("12:00") };

describe("checkinOffered", () => {
  it("is offered from CHECKIN_SOON_MS before the start until the prickle ends", () => {
    const at = (offsetMs: number) => ({ startTime: new Date(NOW.getTime() + offsetMs).toISOString(), endTime: new Date(NOW.getTime() + offsetMs + HOUR).toISOString() });
    expect(checkinOffered(at(CHECKIN_SOON_MS), TIED, NOW)).toBe(true);
    expect(checkinOffered(at(0), TIED, NOW)).toBe(true);
    expect(checkinOffered(at(-HOUR + 60_000), TIED, NOW)).toBe(true);
  });

  it("is not offered earlier, or once the prickle has ended", () => {
    const at = (offsetMs: number) => ({ startTime: new Date(NOW.getTime() + offsetMs).toISOString(), endTime: new Date(NOW.getTime() + offsetMs + HOUR).toISOString() });
    expect(checkinOffered(at(CHECKIN_SOON_MS + 1), TIED, NOW)).toBe(false);
    expect(checkinOffered(at(-HOUR), TIED, NOW)).toBe(false);
  });

  it("needs a personal tie, and being in the room is one", () => {
    expect(checkinOffered(running, [{ kind: "streak", tooltip: [] }], NOW)).toBe(false);
    expect(checkinOffered(running, [{ kind: "present", tooltip: [] }], NOW)).toBe(true);
  });
});

describe("markPresent", () => {
  const ev = (id: string, key: string, name: string, event: string, hhmm: string, host = "host-1") => ({
    id,
    meeting_uuid: "mtg-1",
    meeting_id: null,
    host_id: host,
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
    meeting_uuid: "mtg-1",
    topic: "Prickle",
    start_time: iso("11:00"),
    end_time: null,
    duration_minutes: null,
    host_email: null,
    host_name: null,
    participant_count: null,
    imported_at: null,
    updated_at: null,
    data: { host_id: "host-1" },
  };
  const world = (events: ReturnType<typeof ev>[], prickles: { id: string; startTime: string; endTime: string }[] = []) =>
    createInMemoryRepos(
      new InMemoryDataset({
        prickles: prickles.map((p) => ({ ...p, typeId: null, hostId: null, title: null, source: "calendar", calendarEventId: null })),
        zoomParticipantEvents: events,
        zoomMeetings: [meeting],
        members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Writer", email: "ada@example.test" }],
      })
    );
  const ranked = (id: string, reasons: HighlightReason[] = [], times = running): RankedPrickle => ({
    prickle: { id, typeId: "t1", typeName: "Writing", hostId: null, hostName: null, dayOfWeek: "Monday", startHour: 7, seriesKey: id, ...times },
    reasons,
    priority: PRIORITY.none,
    sortValue: 0,
    recommendationScore: 0,
  });

  it("marks a running prickle the member is in the room for, and puts it first", async () => {
    const repos = world([ev("1", "dev-1", "Ada Writer", "joined", "11:05")]);

    const result = await markPresent(repos, "mbr_AAAAAAAAAAA1", [ranked("other", [], { startTime: iso("13:00"), endTime: iso("14:00") }), ranked("here")], NOW);

    expect(result.map((r) => r.prickle.id)).toEqual(["here", "other"]);
    expect(result[0].reasons).toEqual([expect.objectContaining({ kind: "present" })]);
    expect(result[0].priority).toBe(PRIORITY.calendar);
    expect(result[1].reasons).toEqual([]);
  });

  it("reads presence through the repositories it is given for it, since the member's own can't read the table", async () => {
    // The participant events are service role only: a member's repositories see none of them, so the caller passes
    // service ones for this read alone.
    const members = world([]);
    const service = world([ev("1", "dev-1", "Ada Writer", "joined", "11:05")]);

    const own = await markPresent(members, "mbr_AAAAAAAAAAA1", [ranked("here")], NOW);
    expect(own[0].reasons).toEqual([]);

    const result = await markPresent(members, "mbr_AAAAAAAAAAA1", [ranked("here")], NOW, service);
    expect(result[0].reasons).toEqual([expect.objectContaining({ kind: "present" })]);
  });

  it("counts someone who joined and left after the start, but not someone who left before it", async () => {
    const repos = world([ev("1", "dev-1", "Ada Writer", "joined", "11:05"), ev("2", "dev-1", "Ada Writer", "left", "11:20")]);
    expect((await markPresent(repos, "mbr_AAAAAAAAAAA1", [ranked("here")], NOW))[0].reasons).toHaveLength(1);

    const early = world([ev("1", "dev-1", "Ada Writer", "joined", "10:00"), ev("2", "dev-1", "Ada Writer", "left", "10:50")]);
    expect((await markPresent(early, "mbr_AAAAAAAAAAA1", [ranked("here")], NOW))[0].reasons).toEqual([]);
  });

  it("does not mark a prickle the member only lingered into from the one before it", async () => {
    // In the room from 10:20 to 11:03; the running prickle began at 11:00, the one before it ran 10:00-11:00.
    const before = { startTime: iso("10:00"), endTime: iso("11:00") };
    const repos = world([ev("1", "dev-1", "Ada Writer", "joined", "10:20"), ev("2", "dev-1", "Ada Writer", "left", "11:03")], [{ id: "before", ...before }]);
    const list = [ranked("before", TIED, before), ranked("here")];

    const result = await markPresent(repos, "mbr_AAAAAAAAAAA1", list, new Date(iso("11:05")), repos);
    expect(result.find((r) => r.prickle.id === "here")!.reasons).toEqual([]);
  });

  it("leaves a member who is not in the room, or another member, alone", async () => {
    const list = [ranked("here")];
    expect(await markPresent(world([]), "mbr_AAAAAAAAAAA1", list, NOW)).toBe(list);
    expect(await markPresent(world([ev("1", "dev-1", "Ada Writer", "joined", "11:05")]), "mbr_AAAAAAAAAAA2", list, NOW)).toBe(list);
  });

  it("reads no presence when no running prickle needs it", async () => {
    const repos = world([]);
    const spy = vi.spyOn(repos.zoom, "participantEventsSince");
    const list = [ranked("tied", TIED), ranked("later", [], { startTime: iso("13:00"), endTime: iso("14:00") }), ranked("over", [], { startTime: iso("09:00"), endTime: iso("10:00") })];

    expect(await markPresent(repos, "mbr_AAAAAAAAAAA1", list, NOW)).toBe(list);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the list as it was when presence cannot be read", async () => {
    const repos = world([]);
    vi.spyOn(repos.zoom, "participantEventsSince").mockRejectedValueOnce(new Error("database is down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const list = [ranked("here")];

    expect(await markPresent(repos, "mbr_AAAAAAAAAAA1", list, NOW)).toBe(list);
    expect(error).toHaveBeenCalled();
  });
});

describe("getCheckinPrickles", () => {
  it("looks back far enough to find a prickle that is running", async () => {
    const repos = createInMemoryRepos();
    const spy = vi.spyOn(repos.prickles, "startingBetween");

    await getCheckinPrickles(repos, "mbr_AAAAAAAAAAA1", "UTC", NOW);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ from: new Date(NOW.getTime() - IN_PROGRESS_LOOKBACK_MS).toISOString() }));
  });
});

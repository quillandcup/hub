import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { EXPERIENCED_HOST_PRICKLES, loadScheduleSnapshot, publicTitle, scheduleOptions, scheduleRows, stripText, zoneNote, type ScheduleSnapshot } from "@/lib/landing/live-schedule";

type Seed = NonNullable<ConstructorParameters<typeof InMemoryDataset>[0]>;

// Thursday 10:00 Eastern (EST).
const NOW = new Date("2026-11-19T15:00:00Z");
const MIN = 60_000;
const at = (minutes: number, from = NOW) => new Date(from.getTime() + minutes * MIN).toISOString();

const type = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, normalizedName: name.toLowerCase().replace(/\W+/g, "-"), purpose: "social", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false, ...over });
const PUBLIC = type("ptyp_pub", "Open Mic", { announcedPublicly: true, listedInEvents: true });
const PRIVATE = type("ptyp_priv", "Sprint Writing", { purpose: "writing" });
const EVENT = type("ptyp_evt", "Event", { announcedPublicly: true, listedInEvents: true }); // flagged, but an event's schedule is never a session to join
const HOST = "mbr_HOST0000001";
const prickle = (id: string, typeId: string | null, start: string, end: string, over: Record<string, unknown> = {}) => ({ id, typeId, hostId: null, title: null, startTime: start, endTime: end, source: "calendar", calendarEventId: null, ...over });

const meeting = { id: "z1", meeting_id: "z1", meeting_uuid: "z1", topic: "Prickle", start_time: at(-60), end_time: null, duration_minutes: null, host_email: null, host_name: null, participant_count: null, imported_at: null, updated_at: null, data: { host_id: "h1" } };
const JOIN = { id: "j1", join_url: "https://zoom.example/j/1", meeting_id: "123", passcode: "pw", effective_from: at(-10_000), created_at: at(-10_000), created_by: null };
const joined = (id: string, key: string, name: string) => ({ id, meeting_uuid: "m1", meeting_id: null, host_id: "h1", participant_key: key, participant_name: name, participant_email: null, event: "joined", event_time: at(-5), leave_reason: null, raw_payload: {}, received_at: at(-5) });

function repos(seed: Seed) {
  return createInMemoryRepos(new InMemoryDataset({ zoomMeetings: [meeting], joinSettings: [JOIN], members: [{ id: HOST, name: "Hana Example" }, { id: "mbr_ALICE000001", name: "Alice Quill", email: "alice@example.test" }, { id: "mbr_BEA00000001", name: "Bea Cup", email: "bea@example.test", displayName: "Bea" }], ...seed }));
}
const snapshotFor = (seed: Seed, now = NOW) => loadScheduleSnapshot(repos({ prickleTypes: [PUBLIC, PRIVATE, EVENT], ...seed }), now);

describe("which prickles may appear", () => {
  it("lists every upcoming prickle whatever its type's flags, with or without a type, but not an event's schedule", async () => {
    const snapshot = await snapshotFor({
      prickles: [
        prickle("pub", PUBLIC.id, at(30), at(90), { title: "Open Mic Night" }),
        prickle("priv", PRIVATE.id, at(20), at(80), { title: "Sprint" }),
        prickle("none", null, at(25), at(85), { title: "No type" }),
        prickle("evt", EVENT.id, at(40), at(100), { title: "Retreat day" }),
      ],
    });
    expect(snapshot.prickles.map((p) => p.id)).toEqual(["priv", "none", "pub"]);
  });

  it("lists a prickle of a type that is not announced publicly", async () => {
    expect((await snapshotFor({ prickles: [prickle("priv", PRIVATE.id, at(20), at(80))] })).prickles.map((p) => p.id)).toEqual(["priv"]);
  });

  it("leaves out what already ended or lies beyond the window", async () => {
    const far = await snapshotFor({ prickles: [prickle("past", PUBLIC.id, at(-90), at(-30)), prickle("far", PUBLIC.id, at(24 * 60 * 7), at(24 * 60 * 7 + 60))] });
    expect(far.prickles).toEqual([]);
  });

  it("keeps the soonest twelve", async () => {
    const many = Array.from({ length: 15 }, (_, i) => prickle(`p${String(i).padStart(2, "0")}`, PRIVATE.id, at(10 + i * 5), at(40 + i * 5)));
    const snapshot = await snapshotFor({ prickles: many });
    expect(snapshot.prickles).toHaveLength(12);
    expect(snapshot.prickles[0].id).toBe("p00");
  });

  it("keeps a running prickle and orders by start", async () => {
    const snapshot = await snapshotFor({ prickles: [prickle("later", PUBLIC.id, at(120), at(180)), prickle("now", PUBLIC.id, at(-10), at(50)), prickle("soon", PUBLIC.id, at(30), at(60))] });
    expect(snapshot.prickles.map((p) => p.id)).toEqual(["now", "soon", "later"]);
  });
});

describe("titles", () => {
  it("cleans the calendar's wording and never carries a host's name", () => {
    expect(publicTitle("Quill & Cup [Craft] Prickle: Query Letters", null)).toBe("Query Letters");
    expect(publicTitle("Free Writing Hour w/Hana", null)).toBe("Free Writing Hour");
    expect(publicTitle("Open Mic w/ Hana and Ben", null)).toBe("Open Mic");
    expect(publicTitle(null, "Open Mic")).toBe("Open Mic");
    expect(publicTitle("", "")).toBe("Prickle");
  });
});

describe("what is in the snapshot", () => {
  it("holds a title, times and two facts, and no person (no host name, id, member, link or count of who is coming)", async () => {
    const snapshot = await snapshotFor({
      prickles: [prickle("pub", PUBLIC.id, at(30), at(90), { title: "Open Mic w/Hana", hostId: HOST, description: "Join Alice at https://zoom.example/j/1" })],
    });
    expect(Object.keys(snapshot.prickles[0]).sort()).toEqual(["endTime", "experiencedHost", "id", "startTime", "title"]);
    const json = JSON.stringify(snapshot);
    for (const leak of ["Hana", "Alice", "mbr_", "zoom.example", "passcode", "pw"]) expect(json).not.toContain(leak);
    expect(snapshot.writingNow).toBeNull();
  });
});

describe("an experienced host", () => {
  const past = (n: number) => Array.from({ length: n }, (_, i) => prickle(`old${i}`, PRIVATE.id, at(-(i + 1) * 120 - 600), at(-(i + 1) * 120 - 540), { hostId: HOST }));

  it("is a host with the threshold's number of past prickles, and not one fewer", async () => {
    const enough = await snapshotFor({ prickles: [prickle("pub", PUBLIC.id, at(30), at(90), { hostId: HOST }), ...past(EXPERIENCED_HOST_PRICKLES)] });
    const fewer = await snapshotFor({ prickles: [prickle("pub", PUBLIC.id, at(30), at(90), { hostId: HOST }), ...past(EXPERIENCED_HOST_PRICKLES - 1)] });
    expect(enough.prickles[0].experiencedHost).toBe(true);
    expect(fewer.prickles[0].experiencedHost).toBe(false);
  });

  it("counts only prickles already held: upcoming ones do not make a host experienced", async () => {
    const upcoming = Array.from({ length: 150 }, (_, i) => prickle(`next${i}`, PRIVATE.id, at(200 + i), at(230 + i), { hostId: HOST }));
    const snapshot = await snapshotFor({ prickles: [prickle("pub", PUBLIC.id, at(30), at(90), { hostId: HOST }), ...upcoming, ...past(10)] });
    expect(snapshot.prickles[0].experiencedHost).toBe(false);
  });

  it("is false for a prickle with no host recorded", async () => {
    expect((await snapshotFor({ prickles: [prickle("pub", PUBLIC.id, at(30), at(90))] })).prickles[0].experiencedHost).toBe(false);
  });
});

describe("writing now", () => {
  const running = [prickle("run", PUBLIC.id, at(-20), at(40), { title: "Open Mic" })];
  const base = { prickles: running };

  it("counts everyone in the room, guests included, once a member however many devices", async () => {
    const snapshot = await snapshotFor({
      ...base,
      zoomParticipantEvents: [joined("e1", "k1", "Alice Quill"), joined("e2", "k2", "Alice Quill"), joined("e3", "k3", "Bea"), joined("e4", "k4", "A Guest")],
    });
    expect(snapshot.writingNow).toEqual({ prickleId: "run", count: 3 });
    expect(scheduleRows(snapshot, NOW, scheduleOptions({}))[0].status).toBe("3 writing now");
  });

  it("says just Live for one person, and for an empty room", async () => {
    const one = await snapshotFor({ ...base, zoomParticipantEvents: [joined("e1", "k1", "Alice Quill")] });
    expect(scheduleRows(one, NOW, scheduleOptions({}))[0]).toMatchObject({ state: "live", status: "Live" });
    const none = await snapshotFor(base);
    expect(none.writingNow).toBeNull();
    expect(scheduleRows(none, NOW, scheduleOptions({}))[0].status).toBe("Live");
  });

  it("shows two as writing now", async () => {
    const snapshot = await snapshotFor({ ...base, zoomParticipantEvents: [joined("e1", "k1", "Alice Quill"), joined("e2", "k2", "A Guest")] });
    expect(scheduleRows(snapshot, NOW, scheduleOptions({}))[0].status).toBe("2 writing now");
  });

  it("puts the room's count on the earliest running prickle when two run at once, whatever their types", async () => {
    const snapshot = await snapshotFor({
      prickles: [prickle("earlier", PRIVATE.id, at(-90), at(30)), ...running],
      zoomParticipantEvents: [joined("e1", "k1", "Alice Quill"), joined("e2", "k2", "A Guest")],
    });
    expect(snapshot.writingNow).toEqual({ prickleId: "earlier", count: 2 });
  });

  it("never carries a name out of the room", async () => {
    const snapshot = await snapshotFor({ ...base, zoomParticipantEvents: [joined("e1", "k1", "Alice Quill"), joined("e2", "k2", "Bea")] });
    const json = JSON.stringify([snapshot, scheduleRows(snapshot, NOW, scheduleOptions({ hostStyle: "experience" }))]);
    expect(json).not.toMatch(/Alice|Bea|mbr_/);
  });
});

const snapshot = (prickles: ScheduleSnapshot["prickles"], writingNow: ScheduleSnapshot["writingNow"] = null): ScheduleSnapshot => ({ prickles, writingNow });
const pp = (id: string, startMin: number, endMin: number, over: Partial<ScheduleSnapshot["prickles"][number]> = {}, from = NOW) => ({ id, title: `Title ${id}`, startTime: at(startMin, from), endTime: at(endMin, from), experiencedHost: false, ...over });

describe("rows", () => {
  it("marks running, soon (within an hour, with the minutes) and open, and times them in the organization's zone", () => {
    const rows = scheduleRows(snapshot([pp("a", -10, 50), pp("b", 25, 85), pp("c", 60, 120), pp("d", 61, 120)]), NOW, scheduleOptions({}));
    expect(rows.map((r) => [r.time, r.state, r.status])).toEqual([
      ["9:50 am", "live", "Live"],
      ["10:25 am", "soon", "In 25 min"],
      ["11:00 am", "soon", "In 60 min"],
      ["11:01 am", "open", ""],
    ]);
  });

  it("rounds the minutes up, so it never says it starts sooner than it does", () => {
    const rows = scheduleRows(snapshot([{ ...pp("a", 0, 60), startTime: new Date(NOW.getTime() + 90_000).toISOString() }]), NOW, scheduleOptions({}));
    expect(rows[0].status).toBe("In 2 min");
  });

  it("puts the weekday before a time on another Eastern day, around midnight", () => {
    const lateNight = new Date("2026-11-20T04:30:00Z"); // 23:30 Thursday Eastern
    const rows = scheduleRows(snapshot([pp("a", 10, 70, {}, lateNight), pp("b", 60, 120, {}, lateNight)]), lateNight, scheduleOptions({ hoursAhead: 24 }));
    expect(rows.map((r) => r.time)).toEqual(["11:40 pm", "Fri 12:30 am"]);
  });

  it("handles the day the clocks spring forward (23 hours long)", () => {
    const saturday = new Date("2026-03-07T20:00:00Z"); // 15:00 EST
    const rows = scheduleRows(snapshot([pp("a", 18 * 60, 19 * 60, {}, saturday)]), saturday, scheduleOptions({ hoursAhead: 24 }));
    expect(rows[0].time).toBe("Sun 10:00 am"); // 14:00Z is 10:00 EDT
    expect(stripText(snapshot([pp("a", 18 * 60, 19 * 60, {}, saturday)]), saturday)).toBe(`Your next prickle starts tomorrow at 10:00 am ${zoneNote(saturday.getTime())}`);
  });

  it("keeps to the hours ahead and the most rows, and drops what ended", () => {
    const list = snapshot([pp("gone", -90, -30), pp("a", 10, 40), pp("b", 20, 50), pp("c", 30, 60), pp("far", 60 * 30, 60 * 31)]);
    expect(scheduleRows(list, NOW, scheduleOptions({})).map((r) => r.title)).toEqual(["Title a", "Title b", "Title c"]);
    expect(scheduleRows(list, NOW, scheduleOptions({ maxRows: 2 })).map((r) => r.title)).toEqual(["Title a", "Title b"]);
    expect(scheduleRows(list, NOW, scheduleOptions({ hoursAhead: 48 })).map((r) => r.title)).toEqual(["Title a", "Title b", "Title c", "Title far"]);
  });

  it("bounds the options to what is allowed", () => {
    expect(scheduleOptions({ hoursAhead: 9999, maxRows: 99, hostStyle: "first_name" })).toEqual({ hoursAhead: 144, maxRows: 6, hostStyle: "none" });
    expect(scheduleOptions({ hoursAhead: -3, maxRows: 0 })).toEqual({ hoursAhead: 1, maxRows: 1, hostStyle: "none" });
    expect(scheduleOptions({ hoursAhead: "x", maxRows: undefined })).toEqual({ hoursAhead: 24, maxRows: 5, hostStyle: "none" });
  });

  it("has no host line by default, and only says An experienced host when asked and earned", () => {
    const list = snapshot([pp("a", 30, 60, { experiencedHost: true }), pp("b", 40, 70)]);
    expect(scheduleRows(list, NOW, scheduleOptions({})).map((r) => r.host)).toEqual(["", ""]);
    expect(scheduleRows(list, NOW, scheduleOptions({ hostStyle: "experience" })).map((r) => r.host)).toEqual(["An experienced host", ""]);
  });

  it("never says a count of who is joining", () => {
    const json = JSON.stringify(scheduleRows(snapshot([pp("a", 30, 60), pp("b", -5, 20)], { prickleId: "b", count: 7 }), NOW, scheduleOptions({ hostStyle: "experience" })));
    expect(json).not.toMatch(/joining|first to|be the first|signed up|going/i);
  });

  it("names the zone", () => {
    expect(zoneNote(NOW.getTime())).toMatch(/^E[SD]?T$/);
  });
});

describe("the strip's line", () => {
  it("says a prickle is on while one runs", () => {
    expect(stripText(snapshot([pp("a", -5, 40), pp("b", 20, 50)]), NOW)).toBe("A prickle is on now");
  });

  it("counts the minutes to the next, in the singular for one", () => {
    expect(stripText(snapshot([pp("a", 12, 60)]), NOW)).toBe("Your next prickle starts in 12 minutes");
    expect(stripText(snapshot([{ ...pp("a", 1, 60), startTime: new Date(NOW.getTime() + 20_000).toISOString() }]), NOW)).toBe("Your next prickle starts in 1 minute");
  });

  it("gives the time once it is an hour or more away, today or tomorrow in Eastern days", () => {
    expect(stripText(snapshot([pp("a", 150, 200)]), NOW)).toBe(`Your next prickle starts today at 12:30 pm ${zoneNote(NOW.getTime())}`);
    const lateNight = new Date("2026-11-20T04:30:00Z"); // 23:30 Eastern: an hour later is already tomorrow
    expect(stripText(snapshot([pp("a", 70, 120, {}, lateNight)]), lateNight)).toBe(`Your next prickle starts tomorrow at 12:40 am ${zoneNote(lateNight.getTime())}`);
  });

  it("says nothing when nothing public is on or within a day", () => {
    expect(stripText(snapshot([]), NOW)).toBe("");
    expect(stripText(snapshot([pp("gone", -90, -30), pp("far", 25 * 60, 26 * 60)]), NOW)).toBe("");
  });
});

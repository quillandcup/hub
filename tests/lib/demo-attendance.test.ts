import { describe, expect, it } from "vitest";
import { DEMO_TOPIC_PREFIX, attendanceRows, hash01, hostOf, type Attendee, type PrickleSlot } from "@/demo/attendance";
import { FILLER_MEMBERS, PERSONAS } from "@/demo/personas";

const at = (iso: string) => new Date(iso);
const slot = (key: string, summary: string, start: string, minutes = 60): PrickleSlot => ({
  key,
  summary,
  start: at(start),
  end: new Date(at(start).getTime() + minutes * 60_000),
});
const person = (name: string, joined = "2026-01-01T00:00:00Z", rate = 1): Attendee => ({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`, joinedAt: at(joined), rate });
const NOW = at("2026-10-24T20:00:00Z");

describe("hash01", () => {
  it("is deterministic and stays in [0, 1)", () => {
    expect(hash01("a|b")).toBe(hash01("a|b"));
    expect(hash01("a|b")).not.toBe(hash01("a|c"));
    for (const t of ["", "x", "a long key|with@example.com|join"]) expect(hash01(t)).toBeGreaterThanOrEqual(0), expect(hash01(t)).toBeLessThan(1);
  });
});

describe("hostOf", () => {
  it("reads the host from a calendar title, and is null without one", () => {
    expect(hostOf("Progress Prickle w/Hazel Hosting")).toBe("Hazel Hosting");
    expect(hostOf("Heads Down Prickle")).toBeNull();
  });
});

describe("attendanceRows", () => {
  const past = slot("p1", "Progress Prickle w/Hazel Hosting", "2026-10-23T14:00:00Z");

  it("has the host come early and stay to the end, every time", () => {
    const rows = attendanceRows([past], [person("Hazel Hosting", "2026-01-01T00:00:00Z", 0)], NOW, "123");
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].join_time).getTime()).toBeLessThan(past.start.getTime());
    expect(new Date(rows[0].leave_time).getTime()).toBeGreaterThan(past.end.getTime());
  });

  it("skips prickles that haven't ended yet", () => {
    const future = slot("p2", "Progress Prickle w/Hazel Hosting", "2026-10-24T19:30:00Z");
    expect(attendanceRows([future], [person("Hazel Hosting")], NOW, "123")).toEqual([]);
  });

  it("never has someone attend before they joined", () => {
    const rows = attendanceRows([past], [person("Newcomer Example", "2026-10-24T00:00:00Z", 1)], NOW, "123");
    expect(rows).toEqual([]);
  });

  it("brings people by their rate: nobody at 0, everybody at 1", () => {
    const people = ["A One", "B Two", "C Three", "D Four"].map((n) => person(n, "2026-01-01T00:00:00Z", 1));
    const all = attendanceRows([past], people, NOW, "123");
    expect(new Set(all.map((r) => r.name)).size).toBe(4);
    expect(attendanceRows([past], people.map((p) => ({ ...p, rate: 0 })), NOW, "123")).toEqual([]);
  });

  it("is the same crowd on every run, and a different crowd for a different prickle", () => {
    const people = FILLER_MEMBERS.map((f) => ({ name: f.name, email: f.email, joinedAt: at("2025-01-01T00:00:00Z"), rate: f.rate }));
    const a = attendanceRows([past], people, NOW, "123");
    expect(attendanceRows([past], people, NOW, "123")).toEqual(a);
    const other = attendanceRows([slot("p9", "Progress Prickle", "2026-10-22T14:00:00Z")], people, NOW, "123");
    expect(other.map((r) => r.email)).not.toEqual(a.map((r) => r.email));
  });

  it("writes rows the attendance processing accepts: durations in seconds, a join before every leave, demo-marked", () => {
    const people = FILLER_MEMBERS.map((f) => ({ name: f.name, email: f.email, joinedAt: at("2025-01-01T00:00:00Z"), rate: 1 }));
    const rows = attendanceRows([past, slot("p3", "Sprint Prickle w/Julia Sample", "2026-10-22T15:00:00Z", 45)], people, NOW, "999");
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      const join = new Date(r.join_time).getTime();
      const leave = new Date(r.leave_time).getTime();
      expect(leave).toBeGreaterThan(join);
      expect(r.duration).toBe(Math.round((leave - join) / 1000));
      expect(r.topic.startsWith(DEMO_TOPIC_PREFIX)).toBe(true);
      expect(r.meeting_id).toBe("999");
      expect(r.email).toMatch(/@example\.com$/);
    }
  });

  it("sometimes has a person step out and back: two rows, the second after the first", () => {
    const people = Array.from({ length: 60 }, (_, i) => person(`Guest ${i}`, "2026-01-01T00:00:00Z", 1));
    const rows = attendanceRows([past], people, NOW, "1");
    const byPerson = new Map<string, typeof rows>();
    for (const r of rows) byPerson.set(r.email, [...(byPerson.get(r.email) ?? []), r]);
    const split = [...byPerson.values()].filter((r) => r.length === 2);
    expect(split.length).toBeGreaterThan(0);
    for (const [first, second] of split) expect(new Date(second.join_time).getTime()).toBeGreaterThan(new Date(first.leave_time).getTime());
  });
});

describe("the demo cast, filled out", () => {
  it("uses invented example.com people only, with unique names and addresses", () => {
    const all = [...PERSONAS.filter((p) => p.joinedDaysAgo !== null), ...FILLER_MEMBERS];
    expect(new Set(all.map((p) => p.email)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
    for (const f of FILLER_MEMBERS) {
      expect(f.email).toMatch(/@example\.com$/);
      expect(f.rate).toBeGreaterThan(0);
      expect(f.rate).toBeLessThanOrEqual(1);
    }
  });
});

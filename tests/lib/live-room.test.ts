import { describe, it, expect } from "vitest";
import { LIVE_WINDOW_MS, openParticipants } from "@/lib/live-room";

const NOW = Date.parse("2026-10-19T15:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function ev(key: string, event: "joined" | "left", minutesAgo: number, meeting = "m1") {
  return {
    meeting_uuid: meeting,
    participant_key: key,
    participant_name: `Name ${key}`,
    participant_email: null,
    event,
    event_time: at(minutesAgo),
  };
}

describe("openParticipants", () => {
  it("counts people who joined and have not left", () => {
    const open = openParticipants([ev("a", "joined", 30), ev("b", "joined", 20)], NOW);
    expect(open.map((p) => p.key).length).toBe(2);
  });

  it("drops people who left, and keeps those who rejoined", () => {
    const open = openParticipants(
      [ev("a", "joined", 60), ev("a", "left", 40), ev("b", "joined", 60), ev("b", "left", 40), ev("b", "joined", 10)],
      NOW
    );
    expect(open.map((p) => p.name)).toEqual(["Name b"]);
  });

  it("keeps the same person in two meetings as two entries", () => {
    const open = openParticipants([ev("a", "joined", 30, "m1"), ev("a", "joined", 20, "m2")], NOW);
    expect(open).toHaveLength(2);
  });

  it("ignores events outside the live window so a lost leave cannot pin someone in the room", () => {
    const stale = { ...ev("a", "joined", 0), event_time: new Date(NOW - LIVE_WINDOW_MS - 60_000).toISOString() };
    expect(openParticipants([stale], NOW)).toEqual([]);
  });

  it("is empty with no events", () => {
    expect(openParticipants([], NOW)).toEqual([]);
  });
});

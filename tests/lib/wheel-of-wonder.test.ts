import { describe, it, expect, vi } from "vitest";
import { scoreCandidate, weightedDrawOrder, pickWheelMatch, buildReel, type WheelCandidate } from "@/lib/wheel-of-wonder";

function candidate(overrides: Partial<WheelCandidate> = {}): WheelCandidate {
  return {
    memberId: "m1",
    memberName: "Hedgie",
    photoUrl: null,
    slackUserId: "U1",
    connectionCount: 0,
    recentSlackActivityCount: 0,
    ...overrides,
  };
}

// Deterministic RNG for tests: returns values from a fixed sequence, then
// repeats the last one if exhausted.
function sequenceRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("scoreCandidate", () => {
  it("weighs isolated, inactive members higher than well-connected, active ones", () => {
    const isolated = candidate({ connectionCount: 0, recentSlackActivityCount: 0 });
    const wellConnected = candidate({ connectionCount: 20, recentSlackActivityCount: 30 });
    expect(scoreCandidate(isolated)).toBeGreaterThan(scoreCandidate(wellConnected));
  });

  it("still gives well-connected, active members a nonzero floor weight", () => {
    const wellConnected = candidate({ connectionCount: 50, recentSlackActivityCount: 100 });
    expect(scoreCandidate(wellConnected)).toBeGreaterThan(0);
  });
});

describe("weightedDrawOrder", () => {
  it("returns every candidate exactly once", () => {
    const candidates = [
      candidate({ memberId: "a", connectionCount: 0 }),
      candidate({ memberId: "b", connectionCount: 5 }),
      candidate({ memberId: "c", connectionCount: 10 }),
    ];
    const order = weightedDrawOrder(candidates, Math.random);
    expect(order.map((c) => c.memberId).sort()).toEqual(["a", "b", "c"]);
  });

  it("is deterministic for a fixed rng", () => {
    const candidates = [
      candidate({ memberId: "a", connectionCount: 0 }),
      candidate({ memberId: "b", connectionCount: 0 }),
    ];
    // A low rng draw picks the first remaining candidate (r drops <= 0 on
    // the first weight subtracted), so a fixed low rng consistently draws
    // in order [a, b] for equal-weight candidates.
    const order = weightedDrawOrder(candidates, sequenceRng([0.01, 0.01]));
    expect(order.map((c) => c.memberId)).toEqual(["a", "b"]);
  });
});

describe("pickWheelMatch", () => {
  it("excludes candidates with no mapped Slack user", async () => {
    const candidates = [candidate({ memberId: "no-slack", slackUserId: null })];
    const isReachable = vi.fn().mockResolvedValue(true);
    const winner = await pickWheelMatch(candidates, isReachable);
    expect(winner).toBeNull();
    expect(isReachable).not.toHaveBeenCalled();
  });

  it("falls through to the next weighted candidate when one isn't reachable", async () => {
    const a = candidate({ memberId: "a", slackUserId: "UA" });
    const b = candidate({ memberId: "b", slackUserId: "UB" });
    const isReachable = vi.fn(async (c: WheelCandidate) => c.memberId === "b");

    const winner = await pickWheelMatch([a, b], isReachable, { rng: sequenceRng([0.99, 0.99]) });
    expect(winner?.memberId).toBe("b");
  });

  it("returns null when nobody is reachable within maxAttempts", async () => {
    const candidates = [candidate({ memberId: "a" }), candidate({ memberId: "b" })];
    const isReachable = vi.fn().mockResolvedValue(false);
    const winner = await pickWheelMatch(candidates, isReachable, { maxAttempts: 5 });
    expect(winner).toBeNull();
  });

  it("caps the number of presence checks at maxAttempts", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ memberId: `m${i}` }));
    const isReachable = vi.fn().mockResolvedValue(false);
    await pickWheelMatch(candidates, isReachable, { maxAttempts: 3 });
    expect(isReachable).toHaveBeenCalledTimes(3);
  });
});

describe("buildReel", () => {
  it("always places the winner first and never duplicates them in the rest", () => {
    const winner = candidate({ memberId: "winner" });
    const pool = [
      winner,
      candidate({ memberId: "p1" }),
      candidate({ memberId: "p2" }),
      candidate({ memberId: "p3" }),
    ];
    const reel = buildReel(winner, pool, 4);
    expect(reel[0].memberId).toBe("winner");
    expect(reel.filter((c) => c.memberId === "winner")).toHaveLength(1);
    expect(reel).toHaveLength(4);
  });

  it("caps at the available pool size when fewer candidates than slots exist", () => {
    const winner = candidate({ memberId: "winner" });
    const pool = [winner, candidate({ memberId: "p1" })];
    const reel = buildReel(winner, pool, 8);
    expect(reel).toHaveLength(2);
  });

  it("fills slots with photo-having candidates before falling back to photo-less ones", () => {
    const winner = candidate({ memberId: "winner", photoUrl: "winner.jpg" });
    const pool = [
      winner,
      candidate({ memberId: "no-photo-1", photoUrl: null }),
      candidate({ memberId: "no-photo-2", photoUrl: null }),
      candidate({ memberId: "has-photo-1", photoUrl: "a.jpg" }),
      candidate({ memberId: "has-photo-2", photoUrl: "b.jpg" }),
    ];
    const reel = buildReel(winner, pool, 3); // winner + 2 slots
    expect(reel.slice(1).every((c) => c.photoUrl !== null)).toBe(true);
  });
});

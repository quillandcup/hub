import { describe, it, expect } from "vitest";
import {
  buildQuickLogBlocks,
  groupByMember,
  planPrePrickleNudges,
  replaceAnsweredBlock,
  QUICK_LOG_ACTION_ID,
  type GoalCandidate,
  type UpcomingPrickle,
} from "@/lib/writing-nudges";

const TYPE = "type-progress";
const OTHER_TYPE = "type-other";

// Monday 2026-10-05, 7:00 AM EDT, and another prickle in the same window.
const P1: UpcomingPrickle = { id: "p1", typeId: TYPE, hostId: "host", startTime: "2026-10-05T11:00:00.000Z", typeName: "Progress Prickle" };
const P2: UpcomingPrickle = { id: "p2", typeId: OTHER_TYPE, hostId: "host", startTime: "2026-10-05T11:10:00.000Z", typeName: "Other" };

const goal = (overrides: Partial<GoalCandidate> = {}): GoalCandidate => ({
  memberId: "m1",
  goalId: "g1",
  projectId: "proj1",
  projectTitle: "Novel",
  measure: "words",
  ...overrides,
});

const calendar = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([member, ids]) => [member, new Set(ids)]));

const pairs = (plan: { memberId: string; prickle: UpcomingPrickle }[]) => plan.map((e) => `${e.memberId}:${e.prickle.id}`);

describe("planPrePrickleNudges", () => {
  it("nudges a member with a non-prickles goal for a prickle on their calendar", () => {
    const plan = planPrePrickleNudges([goal({ measure: "chapters" })], [P1, P2], calendar({ m1: ["p1"] }));
    expect(pairs(plan)).toEqual(["m1:p1"]);
  });

  it("doesn't nudge a non-prickles goal for a prickle that isn't on their calendar", () => {
    expect(planPrePrickleNudges([goal()], [P1, P2], calendar({}))).toEqual([]);
    expect(planPrePrickleNudges([goal()], [P1, P2], calendar({ m2: ["p1"] }))).toEqual([]);
  });

  it("doesn't nudge a prickles goal for writing prickles that aren't on their calendar", () => {
    expect(planPrePrickleNudges([goal({ measure: "prickles" })], [P1, P2], calendar({}))).toEqual([]);
  });

  it("sends a member exactly one nudge per prickle, however many goals they have", () => {
    const goals = [
      goal({ goalId: "g1", measure: "words" }),
      goal({ goalId: "g2", projectId: "proj2", measure: "scenes" }),
      goal({ goalId: "g3", measure: "prickles" }),
      goal({ goalId: "g4", projectId: "proj3", measure: "chapters" }),
    ];
    const plan = planPrePrickleNudges(goals, [P1, P2], calendar({ m1: ["p1", "p2"] }));
    expect(pairs(plan)).toEqual(["m1:p1", "m1:p2"]);
  });

  it("plans each member separately", () => {
    const plan = planPrePrickleNudges(
      [goal({ memberId: "m1" }), goal({ memberId: "m2", goalId: "g2" }), goal({ memberId: "m1", goalId: "g3" })],
      [P1, P2],
      calendar({ m1: ["p1"], m2: ["p1", "p2"] })
    );
    expect(pairs(plan)).toEqual(["m1:p1", "m2:p1", "m2:p2"]);
  });
});

describe("groupByMember", () => {
  it("groups in first-seen order", () => {
    const grouped = groupByMember([
      { memberId: "b", n: 1 },
      { memberId: "a", n: 2 },
      { memberId: "b", n: 3 },
    ]);
    expect([...grouped.keys()]).toEqual(["b", "a"]);
    expect(grouped.get("b")!.map((g) => g.n)).toEqual([1, 3]);
  });
});

describe("buildQuickLogBlocks", () => {
  it("asks a single goal in its own measure", () => {
    const [block] = buildQuickLogBlocks("Progress Prickle", "p1", [
      { projectId: "proj", projectTitle: "Novel", measure: "chapters" },
    ]);
    expect(block.text.text).toBe("How much did you write during *Progress Prickle*?");
    expect(block.accessory.action_id).toBe(QUICK_LOG_ACTION_ID);
    expect(block.accessory.options[0]).toEqual({
      text: { type: "plain_text", text: "1 chapter" },
      value: "proj:p1:chapters:1",
    });
  });

  it("names each project when asking about several goals, with distinct block ids", () => {
    const blocks = buildQuickLogBlocks("Progress Prickle", "p1", [
      { projectId: "a", projectTitle: "Novel", measure: "words" },
      { projectId: "b", projectTitle: "Memoir", measure: "scenes" },
    ]);
    expect(blocks.map((b) => b.text.text)).toEqual([
      "How much did you get done on *Novel* during *Progress Prickle*?",
      "How much did you get done on *Memoir* during *Progress Prickle*?",
    ]);
    expect(new Set(blocks.map((b) => b.block_id)).size).toBe(2);
    expect(blocks[1].accessory.options[0].value).toBe("b:p1:scenes:1");
  });
});

describe("replaceAnsweredBlock", () => {
  const blocks = buildQuickLogBlocks("Progress Prickle", "p1", [
    { projectId: "a", projectTitle: "Novel", measure: "words" },
    { projectId: "b", projectTitle: "Memoir", measure: "scenes" },
  ]);

  it("replaces only the answered dropdown", () => {
    const updated = replaceAnsweredBlock(blocks, blocks[0].block_id, "✅ Logged");
    expect(updated[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: "✅ Logged" } });
    expect(updated[1]).toBe(blocks[1]);
  });

  it("falls back to a single confirmation for an older message without matching blocks", () => {
    expect(replaceAnsweredBlock(undefined, "x", "✅ Logged")).toHaveLength(1);
    expect(replaceAnsweredBlock(blocks, "missing", "✅ Logged")).toHaveLength(1);
  });
});

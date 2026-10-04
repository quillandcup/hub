import { describe, it, expect } from "vitest";
import {
  applyCheckinAnswer,
  buildCheckinBlocks,
  buildCheckoutBlocks,
  buildQuickLogBlocks,
  CHECKIN_ANSWER_ACTION_ID,
  CHECKOUT_TIME_SENSITIVE_MS,
  checkinMessage,
  checkoutMessage,
  groupByMember,
  dueCheckoutMembers,
  parseCheckinAnswer,
  planCheckinDMs,
  planCheckoutDMs,
  replaceAnsweredBlock,
  saveCheckinAnswer,
  withSavedAnswer,
  QUICK_LOG_ACTION_ID,
  type GoalCandidate,
  type UpcomingPrickle,
} from "@/lib/prickle-checkin-dms";
import { MAX_FEELINGS, type CheckinInput } from "@/lib/prickle-checkins";
import { createFakeSupabase } from "@/tests/helpers/server-page";

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

describe("planCheckinDMs", () => {
  it("checks in with a member with a non-prickles goal for a prickle on their calendar", () => {
    const plan = planCheckinDMs([goal({ measure: "chapters" })], [P1, P2], calendar({ m1: ["p1"] }));
    expect(pairs(plan)).toEqual(["m1:p1"]);
  });

  it("doesn't check in on a non-prickles goal for a prickle that isn't on their calendar", () => {
    expect(planCheckinDMs([goal()], [P1, P2], calendar({}))).toEqual([]);
    expect(planCheckinDMs([goal()], [P1, P2], calendar({ m2: ["p1"] }))).toEqual([]);
  });

  it("doesn't check in on a prickles goal for writing prickles that aren't on their calendar", () => {
    expect(planCheckinDMs([goal({ measure: "prickles" })], [P1, P2], calendar({}))).toEqual([]);
  });

  it("sends a member exactly one check-in per prickle, however many goals they have", () => {
    const goals = [
      goal({ goalId: "g1", measure: "words" }),
      goal({ goalId: "g2", projectId: "proj2", measure: "scenes" }),
      goal({ goalId: "g3", measure: "prickles" }),
      goal({ goalId: "g4", projectId: "proj3", measure: "chapters" }),
    ];
    const plan = planCheckinDMs(goals, [P1, P2], calendar({ m1: ["p1", "p2"] }));
    expect(pairs(plan)).toEqual(["m1:p1", "m1:p2"]);
  });

  it("plans each member separately", () => {
    const plan = planCheckinDMs(
      [goal({ memberId: "m1" }), goal({ memberId: "m2", goalId: "g2" }), goal({ memberId: "m1", goalId: "g3" })],
      [P1, P2],
      calendar({ m1: ["p1"], m2: ["p1", "p2"] })
    );
    expect(pairs(plan)).toEqual(["m1:p1", "m2:p1", "m2:p2"]);
  });
});

describe("planCheckoutDMs", () => {
  const prickles = [
    { id: "p1", typeName: "Progress Prickle", startTime: "2026-10-05T11:00:00.000Z", endTime: "2026-10-05T12:00:00.000Z" },
    { id: "p2", typeName: "Sprint", startTime: "2026-10-05T12:00:00.000Z", endTime: "2026-10-05T13:00:00.000Z" },
  ];
  const attendees = (entries: Record<string, string[]>) =>
    new Map(Object.entries(entries).map(([prickle, members]) => [prickle, new Set(members)]));

  it("plans one check-out per attendee with a goal, per prickle", () => {
    const plan = planCheckoutDMs(
      prickles,
      attendees({ p1: ["m1", "m2"], p2: ["m1"] }),
      [goal({ memberId: "m1" }), goal({ memberId: "m1", goalId: "g2", projectId: "proj2" })],
      new Set()
    );
    expect(plan.map((e) => `${e.memberId}:${e.prickle.id}`)).toEqual(["m1:p1", "m1:p2"]);
  });

  it("skips pairs already sent and prickles with no attendance yet", () => {
    const plan = planCheckoutDMs(prickles, attendees({ p1: ["m1"] }), [goal()], new Set(["m1:p1"]));
    expect(plan).toEqual([]);
  });
});

describe("dueCheckoutMembers", () => {
  const P = { id: "p1", typeName: "Progress Prickle", startTime: "2026-10-05T11:00:00.000Z", endTime: "2026-10-05T12:00:00.000Z" };
  const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00.000Z`).getTime();
  const due = (presence: Record<string, { join: number; leave: number | null }[]>, now: number, attendance: string[] = []) =>
    [...(dueCheckoutMembers([P], new Map([["p1", new Set(attendance)]]), new Map(Object.entries(presence)), now).get("p1") ?? [])];

  it("checks out someone still in the room 5 minutes after the prickle ends (back-to-back room)", () => {
    const presence = { m1: [{ join: t("10:55"), leave: null }] };
    expect(due(presence, t("12:04"))).toEqual([]);
    expect(due(presence, t("12:05"))).toEqual(["m1"]);
  });

  it("checks out an early leaver 10 minutes after they leave, unless they rejoin", () => {
    expect(due({ m1: [{ join: t("11:00"), leave: t("11:30") }] }, t("11:40"))).toEqual(["m1"]);
    expect(due({ m1: [{ join: t("11:00"), leave: t("11:30") }] }, t("11:39"))).toEqual([]);
    expect(due({ m1: [{ join: t("11:00"), leave: t("11:30") }, { join: t("11:35"), leave: null }] }, t("11:45"))).toEqual([]);
  });

  it("ignores presence that didn't overlap the prickle", () => {
    expect(due({ m1: [{ join: t("09:00"), leave: t("10:30") }] }, t("12:30"))).toEqual([]);
  });

  it("adds attendees from the import, whatever presence says", () => {
    expect(due({}, t("11:10"), ["m2"])).toEqual(["m2"]);
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

const EMPTY: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

describe("buildCheckinBlocks", () => {
  it("asks how they're feeling coming in (up to the cap) and what they need, linking the prickle", () => {
    const [feelings, need, footer] = buildCheckinBlocks("p1", "Progress Prickle", null);
    expect(feelings.text.text).toContain("*Progress Prickle* starts in about 20 minutes");
    expect(feelings.accessory).toMatchObject({
      type: "multi_static_select",
      action_id: CHECKIN_ANSWER_ACTION_ID,
      max_selected_items: MAX_FEELINGS,
    });
    expect(feelings.accessory.options.map((o: any) => o.value)).toContain("tired");
    expect(need.accessory.type).toBe("static_select");
    expect(need.accessory.options[0]).toEqual({ text: { type: "plain_text", text: "Momentum · Get words down" }, value: "momentum" });
    expect(footer.elements[0].text).toContain("/prickles/p1|check-in for this prickle>");
  });

  it("starts from the saved answers", () => {
    const [feelings, need] = buildCheckinBlocks("p1", "Progress Prickle", { ...EMPTY, feelingsBefore: ["tired", "stuck"], need: "unstick" });
    expect(feelings.accessory.initial_options.map((o: any) => o.value)).toEqual(["tired", "stuck"]);
    expect(need.accessory.initial_option.value).toBe("unstick");
  });
});

describe("buildCheckoutBlocks", () => {
  it("asks how it went and how they feel now before the quick-log", () => {
    const blocks = buildCheckoutBlocks("p1", "Progress Prickle", { ...EMPTY, sessionRating: 5 }, [
      { projectId: "a", projectTitle: "Novel", measure: "words" },
    ]);
    expect(blocks.map((b) => b.block_id)).toEqual([
      "prickle_checkin:p1:session_rating",
      "prickle_checkin:p1:feelings_after",
      "quick_log:a:words",
      undefined,
    ]);
    expect(blocks[0].accessory.initial_option).toEqual({ text: { type: "plain_text", text: "Great" }, value: "5" });
    expect(blocks[1].accessory.initial_options).toBeUndefined();
  });
});

describe("parseCheckinAnswer", () => {
  it("reads a multi-select, including one cleared to nothing", () => {
    const action = { action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:feelings_after" };
    expect(parseCheckinAnswer({ ...action, selected_options: [{ value: "calm" }] })).toEqual({
      prickleId: "p1",
      field: "feelings_after",
      values: ["calm"],
    });
    expect(parseCheckinAnswer({ ...action, selected_options: [] })?.values).toEqual([]);
  });

  it("reads a single select", () => {
    expect(
      parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:session_rating", selected_option: { value: "3" } })
    ).toEqual({ prickleId: "p1", field: "session_rating", values: ["3"] });
  });

  it("ignores other actions and unknown fields", () => {
    expect(parseCheckinAnswer({ action_id: QUICK_LOG_ACTION_ID, block_id: "prickle_checkin:p1:need" })).toBeNull();
    expect(parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:host" })).toBeNull();
    expect(parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "quick_log:p1:need" })).toBeNull();
  });
});

describe("applyCheckinAnswer", () => {
  it("replaces only the answered field", () => {
    const base: CheckinInput = { feelingsBefore: ["tired"], need: "gentle", sessionRating: 2, feelingsAfter: [] };
    expect(applyCheckinAnswer(base, "session_rating", ["4"])).toEqual({ ...base, sessionRating: 4 });
    expect(applyCheckinAnswer(base, "feelings_before", [])).toEqual({ ...base, feelingsBefore: [] });
    expect(applyCheckinAnswer(base, "need", ["company"])).toEqual({ ...base, need: "company" });
  });
});

describe("withSavedAnswer", () => {
  it("writes the pick into that question only", () => {
    const blocks = buildCheckinBlocks("p1", "Progress Prickle", null);
    const updated = withSavedAnswer(blocks, { prickleId: "p1", field: "need", values: ["company"] })!;
    expect(updated[1].accessory.initial_option.value).toBe("company");
    expect(updated[0]).toBe(blocks[0]);
  });

  it("drops the initial value when a multi-select is cleared", () => {
    const blocks = buildCheckinBlocks("p1", "Progress Prickle", { ...EMPTY, feelingsBefore: ["tired"] });
    const updated = withSavedAnswer(blocks, { prickleId: "p1", field: "feelings_before", values: [] })!;
    expect(updated[0].accessory.initial_options).toBeUndefined();
  });
});

describe("saveCheckinAnswer", () => {
  const writes = (fake: ReturnType<typeof createFakeSupabase>) =>
    fake.queries
      .filter((q) => q.table === "prickle_checkins")
      .flatMap((q) => q.calls.filter((c) => ["upsert", "update", "delete"].includes(c.method)));

  it("reads only the live check-in", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["gentle"] });
    const read = fake.queries.find((q) => q.calls.some((c) => c.method === "maybeSingle"))!;
    expect(read.calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("merges the answer into the saved check-in", async () => {
    const fake = createFakeSupabase({
      prickle_checkins: { data: [{ feelings_before: ["tired"], need: "gentle", session_rating: null, feelings_after: [] }] },
    });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "session_rating", values: ["4"] })).toBeNull();
    const [upsert] = writes(fake);
    expect(upsert.args).toEqual([
      { member_id: "m1", prickle_id: "p1", feelings_before: ["tired"], need: "gentle", session_rating: 4, feelings_after: [], deleted_at: null },
      { onConflict: "member_id,prickle_id" },
    ]);
  });

  it("soft-deletes the check-in when clearing leaves nothing", async () => {
    const fake = createFakeSupabase({
      prickle_checkins: { data: [{ feelings_before: ["tired"], need: null, session_rating: null, feelings_after: [] }] },
    });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "feelings_before", values: [] })).toBeNull();
    const [update] = writes(fake);
    expect(update.method).toBe("update");
    expect(update.args[0]).toEqual({ deleted_at: expect.any(String) });
  });

  it("writes nothing for a cleared answer with no check-in yet", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "feelings_after", values: [] })).toBeNull();
    expect(writes(fake)).toEqual([]);
  });

  it("rejects an unknown option without writing", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["nap"] })).toBe("Invalid need");
    expect(writes(fake)).toEqual([]);
  });
});

describe("in-app notifications", () => {
  const cleared = (fake: ReturnType<typeof createFakeSupabase>) =>
    fake.queries
      .filter((q) => q.table === "in_app_notifications")
      .map((q) => Object.fromEntries(q.calls.filter((c) => c.method === "eq").map((c) => c.args)));

  it("resolves the in-app check-in once a DM answer completes it", async () => {
    const fake = createFakeSupabase({
      prickle_checkins: { data: [{ feelings_before: ["tired"], need: null, session_rating: null, feelings_after: [] }] },
    });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["gentle"] })).toBeNull();
    expect(cleared(fake)).toEqual([{ member_id: "m1", kind: "prickle_checkin", ref: "p1" }]);
  });

  it("leaves both unresolved while the answers are partial", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "session_rating", values: ["4"] });
    expect(cleared(fake)).toEqual([]);
  });

  it("ties the messages to the prickle, time-sensitive on its timing", () => {
    expect(checkinMessage({ ...P1 }, null)).toMatchObject({
      ref: "p1",
      timeSensitiveUntil: P1.startTime,
    });

    const end = "2026-10-05T12:00:00.000Z";
    const checkout = checkoutMessage({ id: "p1", typeName: "Progress Prickle", startTime: P1.startTime, endTime: end }, null, []);
    expect(checkout).toMatchObject({
      ref: "p1",
      timeSensitiveUntil: new Date(Date.parse(end) + CHECKOUT_TIME_SENSITIVE_MS).toISOString(),
    });
  });
});

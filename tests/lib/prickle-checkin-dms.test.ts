import { describe, it, expect } from "vitest";
import {
  applyCheckinAnswer,
  buildCheckinBlocks,
  buildCheckoutBlocks,
  parseDismiss,
  dismissCheckout,
  dismissCheckin,
  buildQuickLogBlocks,
  CHECKIN_ANSWER_ACTION_ID,
  CHECKOUT_TIME_SENSITIVE_MS,
  checkinMessage,
  checkoutMessage,
  groupByMember,
  dueCheckoutMembers,
  parseCheckinAnswer,
  parseQuickLogAnswer,
  planCheckinDMs,
  planCheckoutDMs,
  replaceAnsweredBlock,
  saveCheckinAnswer,
  withSavedAnswer,
  QUICK_LOG_ACTION_ID,
  type GoalCandidate,
  type UpcomingPrickle,
} from "@/lib/prickle-checkin-dms";
import { checkinToRow, EMPTY_CHECKIN, type CheckinInput } from "@/lib/prickle-checkins";
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
  it("asks for a number, worded for the measure, naming the project and prickle", () => {
    const [block] = buildQuickLogBlocks("Monday Progress Prickle with Jenn P", "p1", [
      { projectId: "proj", projectTitle: "The Hedgehog's Journey", measure: "words" },
    ]);
    expect(block.type).toBe("input");
    expect(block.dispatch_action).toBe(true);
    expect(block.label.text).toBe(
      "How many words did you write on The Hedgehog's Journey during Monday Progress Prickle with Jenn P?"
    );
    expect(block.block_id).toBe("quick_log:p1:proj:words");
    expect(block.element).toMatchObject({
      type: "number_input",
      action_id: QUICK_LOG_ACTION_ID,
      is_decimal_allowed: false,
      dispatch_action_config: { trigger_actions_on: ["on_enter_pressed"] },
    });
  });

  it("varies the question by measure and keeps block ids distinct per project", () => {
    const blocks = buildQuickLogBlocks("Progress Prickle", "p1", [
      { projectId: "a", projectTitle: "Novel", measure: "time_minutes" },
      { projectId: "b", projectTitle: "Memoir", measure: "scenes" },
    ]);
    expect(blocks.map((b) => b.label.text)).toEqual([
      "How many minutes did you spend on Novel during Progress Prickle?",
      "How many scenes did you write on Memoir during Progress Prickle?",
    ]);
    expect(new Set(blocks.map((b) => b.block_id)).size).toBe(2);
  });
});

describe("parseQuickLogAnswer", () => {
  const base = { action_id: QUICK_LOG_ACTION_ID, block_id: "quick_log:p1:proj:words" };

  it("reads a typed amount", () => {
    expect(parseQuickLogAnswer({ ...base, type: "number_input", value: "450" })).toEqual({
      prickleId: "p1",
      projectId: "proj",
      measure: "words",
      amount: 450,
    });
    expect(parseQuickLogAnswer({ ...base, value: "0" })?.amount).toBe(0);
  });

  it("still reads the dropdown from an older DM", () => {
    expect(
      parseQuickLogAnswer({
        action_id: QUICK_LOG_ACTION_ID,
        block_id: "quick_log:proj:words",
        selected_option: { value: "proj:p1:words:500" },
      })
    ).toEqual({ prickleId: "p1", projectId: "proj", measure: "words", amount: 500 });
  });

  it("rejects blanks, negatives, non-numbers, unknown measures and other actions", () => {
    expect(parseQuickLogAnswer({ ...base, value: "" })).toBeNull();
    expect(parseQuickLogAnswer({ ...base, value: "-5" })).toBeNull();
    expect(parseQuickLogAnswer({ ...base, value: "lots" })).toBeNull();
    expect(parseQuickLogAnswer({ ...base, block_id: "quick_log:p1:proj:prickles", value: "3" })).toBeNull();
    expect(parseQuickLogAnswer({ action_id: "other", block_id: base.block_id, value: "3" })).toBeNull();
  });
});

describe("replaceAnsweredBlock", () => {
  const blocks = buildQuickLogBlocks("Progress Prickle", "p1", [
    { projectId: "a", projectTitle: "Novel", measure: "words" },
    { projectId: "b", projectTitle: "Memoir", measure: "scenes" },
  ]);

  it("replaces only the answered question", () => {
    const updated = replaceAnsweredBlock(blocks, blocks[0].block_id, "✅ Logged");
    expect(updated[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: "✅ Logged" } });
    expect(updated[1]).toBe(blocks[1]);
  });

  it("falls back to a single confirmation for an older message without matching blocks", () => {
    expect(replaceAnsweredBlock(undefined, "x", "✅ Logged")).toHaveLength(1);
    expect(replaceAnsweredBlock(blocks, "missing", "✅ Logged")).toHaveLength(1);
  });
});

const EMPTY = EMPTY_CHECKIN;
const ids = (blocks: any[]) => blocks.map((b) => b.block_id);
const picked = (row: any) => row.elements.filter((e: any) => e.style === "primary").map((e: any) => e.value);

describe("buildCheckinBlocks", () => {
  it("asks mood on two labeled scales, the feeling from the wheel, then the intention, linking the prickle", () => {
    const blocks = buildCheckinBlocks("p1", "Progress Prickle", null);
    expect(ids(blocks)).toEqual([
      undefined,
      "prickle_checkin:p1:pleasant_before",
      undefined,
      "prickle_checkin:p1:energy_before",
      "prickle_checkin:p1:emotion_before",
      "prickle_checkin:p1:need",
      "prickle_dismiss:checkin:p1",
      undefined,
    ]);
    expect(blocks[0].text.text).toBe("*Progress Prickle* starts in about 20 minutes. Overall, how do you feel?");
    expect(blocks[1].elements.map((e: any) => e.text.text)).toEqual(["Very bad", "Bad", "Okay", "Good", "Very good"]);
    expect(blocks[1].elements.map((e: any) => e.value)).toEqual(["1", "2", "3", "4", "5"]);
    expect(blocks[3].elements.map((e: any) => e.text.text)).toEqual(["Very low", "Low", "Medium", "High", "Very high"]);

    expect(blocks[4].text.text).toBe("Name the feeling \n_(Feeling Wheel by Gloria Willcox)_");
    const wheel = blocks[4].accessory;
    expect(wheel).toMatchObject({ type: "static_select", action_id: CHECKIN_ANSWER_ACTION_ID });
    expect(wheel.option_groups.map((g: any) => g.label.text)).toEqual(["Mad", "Scared", "Joyful", "Powerful", "Peaceful", "Sad"]);
    expect(wheel.option_groups.flatMap((g: any) => g.options)).toHaveLength(78);
    expect(wheel.option_groups[0].options.slice(0, 5)).toEqual([
      { text: { type: "plain_text", text: "Mad" }, value: "mad" },
      { text: { type: "plain_text", text: "Hurt" }, value: "hurt" },
      { text: { type: "plain_text", text: "Jealous" }, value: "jealous" },
      { text: { type: "plain_text", text: "Hostile" }, value: "hostile" },
      { text: { type: "plain_text", text: "Selfish" }, value: "selfish" },
    ]);
    // The core, then its pairs (each middle-ring word, then the outer-ring word beside it): 13 per group.
    expect(wheel.option_groups[0].options).toHaveLength(13);

    expect(blocks[5].text.text).toContain("Choose your intention");
    expect(blocks[5].accessory.options[0]).toEqual({ text: { type: "plain_text", text: "Momentum · Get words down" }, value: "momentum" });
    expect(blocks[7].elements[0].text).toContain("/my-prickles/history?checkin=p1|check-in for this prickle>");
  });

  it("starts from the saved answers", () => {
    const blocks = buildCheckinBlocks("p1", "Progress Prickle", { ...EMPTY, pleasantBefore: 2, emotionBefore: "lonely", need: "unstuck" });
    expect(picked(blocks[1])).toEqual(["2"]);
    expect(picked(blocks[3])).toEqual([]);
    expect(blocks[4].accessory.initial_option.value).toBe("lonely");
    expect(blocks[5].accessory.initial_option.value).toBe("unstuck");
  });
});

describe("buildCheckoutBlocks", () => {
  it("asks got-what-you-came-for, then mood and the feeling again, then the progress questions", () => {
    const blocks = buildCheckoutBlocks(
      "p1",
      "Progress Prickle",
      { ...EMPTY, intentionMet: 4, energyAfter: 2 },
      [{ projectId: "a", projectTitle: "Novel", measure: "words" }],
      "Monday Progress Prickle with Jenn P"
    );
    expect(ids(blocks)).toEqual([
      undefined,
      "prickle_checkin:p1:intention_met",
      undefined,
      "prickle_checkin:p1:pleasant_after",
      undefined,
      "prickle_checkin:p1:energy_after",
      "prickle_checkin:p1:emotion_after",
      "quick_log:p1:a:words",
      "prickle_dismiss:checkout:p1",
      undefined,
    ]);
    expect(blocks[0].text.text).toBe("Checking out of *Progress Prickle*: Did you get what you came for?");
    expect(blocks[1].elements.map((e: any) => e.text.text)).toEqual(["Not at all", "A little", "Somewhat", "Mostly", "Completely"]);
    expect(picked(blocks[1])).toEqual(["4"]);
    expect(picked(blocks[5])).toEqual(["2"]);
    expect(blocks[6].accessory.initial_option).toBeUndefined();
    expect(blocks[7].label.text).toContain("during Monday Progress Prickle with Jenn P?");
    expect(blocks[8].elements[0]).toMatchObject({ action_id: "prickle_dismiss", value: "checkout:p1" });
    expect(blocks[9].elements[0].text).toContain("/my-prickles/history?checkout=p1|check-out for this prickle>");
  });

  it("stays within Slack's 50-block limit with a quick-log per project", () => {
    const prompts = Array.from({ length: 10 }, (_, i) => ({ projectId: `p${i}`, projectTitle: `P${i}`, measure: "words" as const }));
    expect(buildCheckoutBlocks("p1", "Progress Prickle", null, prompts).length).toBeLessThanOrEqual(50);
  });
});

describe("parseCheckinAnswer", () => {
  it("reads a select, including one cleared to nothing", () => {
    const action = { action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:emotion_after" };
    expect(parseCheckinAnswer({ ...action, selected_option: { value: "hopeful" } })).toEqual({
      prickleId: "p1",
      field: "emotion_after",
      values: ["hopeful"],
    });
    expect(parseCheckinAnswer(action)?.values).toEqual([]);
  });

  it("reads a scale button, whose action id carries its point", () => {
    expect(
      parseCheckinAnswer({
        action_id: `${CHECKIN_ANSWER_ACTION_ID}:5`,
        block_id: "prickle_checkin:p1:intention_met",
        type: "button",
        value: "5",
      })
    ).toEqual({ prickleId: "p1", field: "intention_met", values: ["5"] });
  });

  it("ignores other actions, unknown fields and the retired questions", () => {
    expect(parseCheckinAnswer({ action_id: QUICK_LOG_ACTION_ID, block_id: "prickle_checkin:p1:need" })).toBeNull();
    expect(parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:host" })).toBeNull();
    expect(parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "quick_log:p1:need" })).toBeNull();
    expect(parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:feelings_before" })).toBeNull();
    expect(parseCheckinAnswer({ action_id: CHECKIN_ANSWER_ACTION_ID, block_id: "prickle_checkin:p1:session_rating" })).toBeNull();
  });
});

describe("applyCheckinAnswer", () => {
  it("replaces only the answered field, as a number for scales", () => {
    const base: CheckinInput = { ...EMPTY, need: "company", pleasantBefore: 2 };
    expect(applyCheckinAnswer(base, "pleasant_before", ["4"])).toEqual({ ...base, pleasantBefore: 4 });
    expect(applyCheckinAnswer(base, "intention_met", ["5"])).toEqual({ ...base, intentionMet: 5 });
    expect(applyCheckinAnswer(base, "emotion_before", ["anxious"])).toEqual({ ...base, emotionBefore: "anxious" });
    expect(applyCheckinAnswer(base, "need", [])).toEqual({ ...base, need: null });
  });
});

describe("withSavedAnswer", () => {
  it("highlights the picked point in its own row and clears the previous one", () => {
    const blocks = buildCheckoutBlocks("p1", "Progress Prickle", { ...EMPTY, intentionMet: 2, pleasantAfter: 3 }, []);
    const updated = withSavedAnswer(blocks, { prickleId: "p1", field: "intention_met", values: ["5"] })!;
    const row = (field: string) => updated.find((b) => b.block_id === `prickle_checkin:p1:${field}`);
    expect(picked(row("intention_met"))).toEqual(["5"]);
    expect(picked(row("pleasant_after"))).toEqual(["3"]);
  });

  it("writes the pick into that question only", () => {
    const blocks = buildCheckinBlocks("p1", "Progress Prickle", null);
    const updated = withSavedAnswer(blocks, { prickleId: "p1", field: "emotion_before", values: ["proud"] })!;
    expect(updated[4].accessory.initial_option).toEqual({ text: { type: "plain_text", text: "Proud" }, value: "proud" });
    expect(updated[5]).toBe(blocks[5]);
  });

  it("drops the initial value when a select is cleared", () => {
    const blocks = buildCheckinBlocks("p1", "Progress Prickle", { ...EMPTY, need: "company" });
    const updated = withSavedAnswer(blocks, { prickleId: "p1", field: "need", values: [] })!;
    expect(updated[5].accessory.initial_option).toBeUndefined();
  });
});

describe("saveCheckinAnswer", () => {
  const writes = (fake: ReturnType<typeof createFakeSupabase>) =>
    fake.queries
      .filter((q) => q.table === "prickle_checkins")
      .flatMap((q) => q.calls.filter((c) => ["upsert", "update", "delete"].includes(c.method)));

  it("reads only the live check-in", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["company"] });
    const read = fake.queries.find((q) => q.calls.some((c) => c.method === "maybeSingle"))!;
    expect(read.calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("merges the answer into the saved check-in", async () => {
    const fake = createFakeSupabase({
      prickle_checkins: { data: [checkinToRow({ ...EMPTY, pleasantBefore: 2, need: "company" })] },
    });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "energy_before", values: ["4"] })).toBeNull();
    const [upsert] = writes(fake);
    expect(upsert.args).toEqual([
      {
        member_id: "m1",
        prickle_id: "p1",
        ...checkinToRow({ ...EMPTY, pleasantBefore: 2, energyBefore: 4, need: "company" }),
        saved_via: "slack",
        deleted_at: null,
      },
      { onConflict: "member_id,prickle_id" },
    ]);
  });

  it("soft-deletes the check-in when clearing leaves nothing", async () => {
    const fake = createFakeSupabase({
      prickle_checkins: { data: [checkinToRow({ ...EMPTY, emotionBefore: "sleepy" })] },
    });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "emotion_before", values: [] })).toBeNull();
    const [update] = writes(fake);
    expect(update.method).toBe("update");
    expect(update.args[0]).toEqual({ deleted_at: expect.any(String), saved_via: "slack" });
  });

  it("writes nothing for a cleared answer with no check-in yet", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "emotion_after", values: [] })).toBeNull();
    expect(writes(fake)).toEqual([]);
  });

  it("rejects an unknown option without writing", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["nap"] })).toBe("Invalid intention");
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
      prickle_checkins: { data: [checkinToRow({ ...EMPTY, pleasantBefore: 2, energyBefore: 3 })] },
    });
    expect(await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["company"] })).toBeNull();
    expect(cleared(fake)).toEqual([{ member_id: "m1", kind: "prickle_checkin", ref: "p1" }]);
  });

  it("leaves both unresolved while the answers are partial", async () => {
    const fake = createFakeSupabase({ prickle_checkins: { data: [] } });
    await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "need", values: ["company"] });
    await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "intention_met", values: ["4"] });
    expect(cleared(fake)).toEqual([]);
  });

  it("resolves the in-app check-out once got-what-you-came-for and mood are in", async () => {
    const fake = createFakeSupabase({
      prickle_checkins: { data: [checkinToRow({ ...EMPTY, intentionMet: 4, pleasantAfter: 4 })] },
    });
    await saveCheckinAnswer(fake, "m1", { prickleId: "p1", field: "energy_after", values: ["3"] });
    expect(cleared(fake)).toEqual([{ member_id: "m1", kind: "prickle_checkout", ref: "p1" }]);
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

describe("dismissing a check-in or check-out", () => {
  it("reads the half and prickle off a Skip button, and nothing else", () => {
    expect(parseDismiss({ action_id: "prickle_dismiss", value: "checkout:p1" })).toEqual({ half: "checkout", prickleId: "p1" });
    expect(parseDismiss({ action_id: "prickle_dismiss", value: "checkin:p2" })).toEqual({ half: "checkin", prickleId: "p2" });
    expect(parseDismiss({ action_id: "prickle_dismiss", value: "other:p1" })).toBeNull();
    expect(parseDismiss({ action_id: "prickle_checkin_answer", value: "checkout:p1" })).toBeNull();
    expect(parseDismiss({ action_id: "prickle_dismiss" })).toBeNull();
  });

  it("puts a Skip button in both DMs", () => {
    const out = buildCheckoutBlocks("p1", "Progress Prickle", null, []);
    const inn = buildCheckinBlocks("p1", "Progress Prickle", null);
    expect(out.find((b) => b.block_id === "prickle_dismiss:checkout:p1").elements[0].text.text).toBe("Skip check-out");
    expect(inn.find((b) => b.block_id === "prickle_dismiss:checkin:p1").elements[0].text.text).toBe("Skip check-in");
  });

  it.each([
    ["checkout", dismissCheckout, "prickle_checkout_dismissals"],
    ["checkin", dismissCheckin, "prickle_checkin_dismissals"],
  ] as const)("records the %s dismissal and marks its in-app notification read", async (_half, dismiss, table) => {
    const calls: [string, unknown][] = [];
    const chain: any = { eq: () => chain, is: () => Promise.resolve({ error: null }) };
    const supabase = {
      from: (t: string) => ({
        upsert: (row: unknown) => (calls.push([t, row]), Promise.resolve({ error: null })),
        update: (row: unknown) => (calls.push([t, row]), chain),
      }),
    };
    expect(await dismiss(supabase, "m1", "p1")).toBeNull();
    expect(calls[0]).toEqual([table, { member_id: "m1", prickle_id: "p1" }]);
    expect(calls[1][0]).toBe("in_app_notifications");
  });
});

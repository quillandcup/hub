import { describe, expect, it } from "vitest";
import { describeRow, type ActivityFeedRow } from "@/lib/activity-feed";
import {
  CARE_ACTIVITY_TITLES,
  CARE_ACTIVITY_TYPES,
  careActivitySentence,
  careActivityUserIds,
  careEventOfAudit,
  careKindOfActivityType,
  careSentence,
  endedHowPhrase,
} from "@/lib/care-events";
import { CARE_ENDED_HOW, CARE_ENDED_HOW_LABELS } from "@/lib/care";
import { careStartInstant } from "@/lib/care";

const OWNER = "00000000-0000-4000-a000-0000000000a1";
const RECEIVER = "00000000-0000-4000-a000-0000000000b2";
const OFFERER = "00000000-0000-4000-a000-0000000000c3";
// A name that would break text built by hand: both characters Slack and HTML escape.
const TRICKY = "Ann & <Bee>";

function audit(overrides: Partial<ActivityFeedRow> & { fields?: Record<string, { old: unknown; new: unknown }> }): ActivityFeedRow {
  const { fields, ...rest } = overrides;
  return {
    event_id: "audit:1",
    kind: "audit",
    occurred_at: "2027-03-01T15:00:00Z",
    is_audit: true,
    actor_user_id: OWNER,
    actor_kind: "staff",
    actor_label: "Staff Example",
    member_id: "mbr_AAAAAAAAAAA1",
    member_name: "Ada Example",
    acting_as_member_id: null,
    acting_as_member_name: null,
    event_type: "update",
    entity_type: "care_engagement",
    entity_id: "care_AAAAAAAAAAA1",
    title: null,
    description: null,
    source: "audit_log",
    data: fields ?? {},
    ...rest,
  };
}

const refs = { [OWNER]: { label: "Owner Example" }, [RECEIVER]: { label: TRICKY }, [OFFERER]: { label: "Offerer Example" } };

describe("the sentences of a care plan's events", () => {
  it.each([
    ["started", {}, "started a care plan"],
    ["renewed", {}, "renewed the care plan"],
    ["renewed", { planNumber: 2 }, "renewed the care plan (second plan)"],
    ["renewed", { planNumber: 11 }, "renewed the care plan (11th plan)"],
    ["closed", { endedHow: "ran_its_course" }, "closed the care plan: ran its course"],
    ["closed", { endedHow: "no_reply" }, "closed the care plan: no reply"],
    ["closed", {}, "closed the care plan"],
    ["closed", { endedHow: "typed by someone" }, "closed the care plan"],
    ["offered", { name: TRICKY }, `offered the care plan to ${TRICKY}`],
    ["offered", {}, "offered the care plan to a colleague"],
    ["accepted", { name: TRICKY }, `accepted the care plan from ${TRICKY}`],
    ["accepted", {}, "accepted a care plan"],
    ["declined", { name: TRICKY }, `declined the care plan ${TRICKY} offered`],
    ["declined", {}, "declined an offered care plan"],
    ["cancelled", { name: TRICKY }, `took back the offer of the care plan to ${TRICKY}`],
    ["cancelled", {}, "took back the offer of the care plan"],
    ["claimed", {}, "took a care plan that had no owner"],
    ["took_over", { name: TRICKY }, `took over the care plan from ${TRICKY}`],
    ["took_over", {}, "took over a care plan"],
    ["start_moved", { day: "2027-03-09" }, "moved the care plan's start to 3/9/2027"],
    ["start_moved", {}, "moved the care plan's start"],
    ["edited", { fields: ["notes", "next_step", "reason"] }, "changed the care plan (note, next step, reason)"],
    ["edited", { fields: ["something_else"] }, "changed the care plan"],
    ["removed", {}, "removed the care plan"],
    ["restored", {}, "brought the care plan back"],
  ] as const)("%s %j reads %s", (kind, context, sentence) => {
    expect(careSentence(kind, context)).toBe(sentence);
  });

  it("words every ending from its label", () => {
    for (const how of CARE_ENDED_HOW) expect(careSentence("closed", { endedHow: how })).toBe(`closed the care plan: ${endedHowPhrase(how)}`);
    expect(endedHowPhrase("handed_off")).toBe(CARE_ENDED_HOW_LABELS.handed_off.toLowerCase());
  });
});

describe("a care plan's audit row", () => {
  const read = (overrides: Parameters<typeof audit>[0]) => {
    const row = audit({ refs, ...overrides });
    return describeRow(row);
  };

  it("says a start, a renewal (with its number) and a removal", () => {
    expect(read({ event_type: "insert", fields: { reason: { old: null, new: "check_in" } } })).toBe("started a care plan");
    expect(read({ event_type: "insert", planNumber: 3, fields: { renewed_from: { old: null, new: "care_AAAAAAAAAAA0" } } })).toBe("renewed the care plan (third plan)");
    expect(read({ event_type: "delete" })).toBe("removed the care plan");
    expect(read({ fields: { deleted_at: { old: null, new: "2027-03-02T10:00:00Z" } } })).toBe("removed the care plan");
    expect(read({ fields: { deleted_at: { old: "2027-03-02T10:00:00Z", new: null } } })).toBe("brought the care plan back");
  });

  it("says how a plan closed", () => {
    expect(read({ fields: { closed_at: { old: null, new: "2027-03-02T10:00:00Z" }, ended_how: { old: null, new: "back_in_community" } } })).toBe("closed the care plan: back in the community");
  });

  it("says each step of a hand-over with the colleague's name, the name kept as it is", () => {
    const offer = { handover_to: { old: null, new: RECEIVER }, handover_by: { old: null, new: OWNER }, handover_at: { old: null, new: "2027-03-02T10:00:00Z" } };
    expect(read({ fields: offer })).toBe(`offered the care plan to ${TRICKY}`);
    // The receiver answers: the actor is the one it was offered to.
    const gone = { handover_to: { old: RECEIVER, new: null }, handover_by: { old: OFFERER, new: null }, handover_at: { old: "2027-03-02T10:00:00Z", new: null } };
    expect(read({ actor_user_id: RECEIVER, fields: gone })).toBe("declined the care plan Offerer Example offered");
    // Someone else takes it back.
    expect(read({ actor_user_id: OFFERER, fields: gone })).toBe(`took back the offer of the care plan to ${TRICKY}`);
    // Accepting changes the owner (it comes from the old one) and clears the offer.
    expect(read({ actor_user_id: RECEIVER, fields: { owned_by: { old: OWNER, new: RECEIVER }, ...gone } })).toBe("accepted the care plan from Owner Example");
    // A plan with no owner is taken, not accepted.
    expect(read({ actor_user_id: RECEIVER, fields: { owned_by: { old: null, new: RECEIVER } } })).toBe("took a care plan that had no owner");
    // An owner change with no offer accepted is a takeover, named for whose plan it was.
    expect(read({ actor_user_id: RECEIVER, fields: { owned_by: { old: OWNER, new: RECEIVER } } })).toBe("took over the care plan from Owner Example");
    expect(read({ actor_user_id: RECEIVER, fields: { owned_by: { old: RECEIVER, new: OFFERER } } })).toBe(`took over the care plan from ${TRICKY}`);
    // An unrelated offer cleared in a row that did not change the owner is not an accept.
    expect(describeRow(audit({ actor_user_id: RECEIVER, refs, fields: { owned_by: { old: OWNER, new: RECEIVER }, handover_to: { old: null, new: RECEIVER } } }))).toBe("took over the care plan from Owner Example");
  });

  it("falls back to plain words when a name could not be resolved", () => {
    expect(describeRow(audit({ fields: { handover_to: { old: null, new: RECEIVER } } }))).toBe("offered the care plan to a colleague");
  });

  it("says a moved start as the Eastern day it moved to, on both sides of Eastern midnight and the clock changes", () => {
    const moved = (iso: string) => read({ fields: { opened_at: { old: "2027-03-01T17:00:00Z", new: iso }, period_ends_on: { old: "2027-03-31", new: "2027-04-12" } } });
    // 23:30 Eastern on March 8 (EST) is March 9 04:30 UTC: still March 8. 00:30 Eastern on March 9 is March 9.
    expect(moved("2027-03-09T04:30:00Z")).toBe("moved the care plan's start to 3/8/2027");
    expect(moved("2027-03-09T05:30:00Z")).toBe("moved the care plan's start to 3/9/2027");
    // The day clocks go forward (March 14, 2027): noon Eastern is EDT.
    expect(moved(careStartInstant("2027-03-14", new Date("2027-03-20T15:00:00Z")).toISOString())).toBe("moved the care plan's start to 3/14/2027");
    // The day clocks go back (11/7/2027).
    expect(moved(careStartInstant("2027-11-07", new Date("2027-11-20T15:00:00Z")).toISOString())).toBe("moved the care plan's start to 11/7/2027");
  });

  it("names the fields an edit changed and never their values: the typed ones arrive redacted, and the sentence ignores values anyway", () => {
    const sentence = read({
      fields: {
        notes: { old: "[redacted]", new: "[redacted]" },
        next_step: { old: null, new: "[redacted]" },
        reason: { old: "check_in", new: "welcome" },
        follow_up_on: { old: null, new: "2027-04-01" },
      },
    });
    expect(sentence).toBe("changed the care plan (note, next step, reason, follow-up day)");
    // Even a delta that carried text would not put it in the sentence.
    expect(read({ fields: { notes: { old: "she is worried about her mother", new: "she is feeling better" } } })).toBe("changed the care plan (note)");
  });

  it("is only for care plans", () => {
    expect(careEventOfAudit({ entity_type: "mentorship", event_type: "insert", actor_user_id: null, fields: {} })).toBeNull();
  });
});

describe("a care plan's row on the member's timeline", () => {
  const names = (id: string) => ({ [OWNER]: "Owner Example", [RECEIVER]: TRICKY, [OFFERER]: "Offerer Example" })[id] ?? null;
  const sentence = (activity_type: string, data: unknown, description: string | null = null) => careActivitySentence({ activity_type, data, description }, names);

  it("says each kind, with names resolved from the account ids in its data", () => {
    expect(sentence("care_started", null)).toBe("started a care plan");
    expect(sentence("care_renewed", { plan_number: 2 })).toBe("renewed the care plan (second plan)");
    expect(sentence("care_closed", { ended_how: "no_reply" })).toBe("closed the care plan: no reply");
    expect(sentence("care_handover_offered", { to_user_id: RECEIVER })).toBe(`offered the care plan to ${TRICKY}`);
    expect(sentence("care_handover_accepted", { from_user_id: OWNER })).toBe("accepted the care plan from Owner Example");
    expect(sentence("care_handover_declined", { from_user_id: OFFERER })).toBe("declined the care plan Offerer Example offered");
    expect(sentence("care_handover_cancelled", { to_user_id: RECEIVER })).toBe(`took back the offer of the care plan to ${TRICKY}`);
    expect(sentence("care_plan_claimed", null)).toBe("took a care plan that had no owner");
  });

  it("reads a close written before the ending was in its data from the fixed labels in its description", () => {
    expect(sentence("care_closed", null, "A check-in: Ran its course")).toBe("closed the care plan: ran its course");
    expect(sentence("care_closed", null, "A check-in: something typed")).toBe("closed the care plan");
  });

  it("is plainer when a name is not known, and is null for any other kind of row", () => {
    expect(careActivitySentence({ activity_type: "care_handover_offered", data: { to_user_id: "00000000-0000-4000-a000-0000000000ff" } })).toBe("offered the care plan to a colleague");
    expect(sentence("slack_message", null)).toBeNull();
    expect(careKindOfActivityType("care_started")).toBe("started");
    expect(careKindOfActivityType("slack_message")).toBeNull();
  });

  it("lists the account ids a row names, and nothing else in its data", () => {
    expect(careActivityUserIds({ to_user_id: RECEIVER, from_user_id: OWNER, plan_number: 2, note: "typed" })).toEqual([OWNER, RECEIVER]);
    expect(careActivityUserIds(null)).toEqual([]);
    expect(careActivityUserIds([RECEIVER])).toEqual([]);
  });

  it("has a title for every kind that has a row, none of them naming a person or carrying typed text", () => {
    for (const kind of Object.keys(CARE_ACTIVITY_TYPES) as (keyof typeof CARE_ACTIVITY_TYPES)[]) {
      expect(CARE_ACTIVITY_TITLES[kind]).toMatch(/care plan/i);
    }
  });

  it("is what the feed shows for a care row of the timeline, if one is listed", () => {
    const row: ActivityFeedRow = {
      ...audit({ kind: "activity", source: "care", event_type: "care_handover_offered", data: { to_user_id: RECEIVER }, entity_type: null }),
      title: "Offered a care plan to a colleague",
    };
    expect(describeRow(row)).toBe("offered the care plan to a colleague");
  });
});

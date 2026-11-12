import { describe, expect, it } from "vitest";
import {
  CARE_CLOSE_OPTIONS,
  CARE_ENDED_HOW,
  CARE_ENDED_HOW_HELP,
  CARE_ENDED_HOW_LABELS,
  CARE_REASONS,
  CARE_REASON_HELP,
  CARE_REASON_LABELS,
  CARE_SETTINGS,
  CARE_WINDOW_SETTINGS,
  careCheckpoints,
  careStatus,
  careWindows,
  commitmentLength,
  daysAgoLabel,
  endOfOrgDay,
  isActiveStatus,
  isCareEndedHow,
  isCareId,
  isCareReason,
  isCloseOption,
  isFollowUpDue,
  isMessageDirection,
  lastActivityAt,
  memberWroteLast,
  periodEndsOn,
  periodNumber,
  planOrdinal,
  sortActive,
  sortEarlier,
  type CareTimes,
} from "@/lib/care";
import {
  CARE_AFTER_FROM_DAYS,
  CARE_AFTER_TO_DAYS,
  CARE_BEFORE_DAYS,
  CARE_ENGAGEMENT_DAYS,
  CARE_LAPSE_GRACE_DAYS,
  CARE_QUIET_DAYS,
  CARE_RETENTION_CHECKPOINT_DAYS,
} from "@/lib/config";

const settings = { engagementDays: 30, lapseGraceDays: 14, quietDays: 14 };

/** An engagement opened 2026-03-01 (Eastern) whose period ends 2026-03-31, she wrote first. */
const base: CareTimes = {
  opened_at: "2026-03-01T15:00:00.000Z",
  period_ends_on: "2026-03-31",
  closed_at: null,
  last_staff_message_at: "2026-03-01T15:00:00.000Z",
  last_member_message_at: null,
};

describe("settings come from the config", () => {
  it("reads the length, grace and quiet days and the three windows from app.config.ts", () => {
    expect(CARE_SETTINGS).toEqual({ engagementDays: CARE_ENGAGEMENT_DAYS, lapseGraceDays: CARE_LAPSE_GRACE_DAYS, quietDays: CARE_QUIET_DAYS });
    expect(CARE_WINDOW_SETTINGS).toEqual({ beforeDays: CARE_BEFORE_DAYS, afterFromDays: CARE_AFTER_FROM_DAYS, afterToDays: CARE_AFTER_TO_DAYS });
    for (const n of [CARE_ENGAGEMENT_DAYS, CARE_LAPSE_GRACE_DAYS, CARE_QUIET_DAYS, CARE_BEFORE_DAYS]) expect(n).toBeGreaterThan(0);
    expect(CARE_AFTER_TO_DAYS).toBeGreaterThan(CARE_AFTER_FROM_DAYS);
  });

  it("uses the configured length when no length is given", () => {
    expect(periodEndsOn(new Date("2026-03-01T15:00:00Z"))).toBe(periodEndsOn(new Date("2026-03-01T15:00:00Z"), CARE_ENGAGEMENT_DAYS));
  });
});

describe("the value sets", () => {
  it("accepts only members of each set", () => {
    expect(isCareReason("introduction")).toBe(true);
    expect(isCareReason("hello")).toBe(false);
    expect(isCareEndedHow("renewed")).toBe(true);
    expect(isCareEndedHow(null)).toBe(false);
    expect(isMessageDirection("staff")).toBe(true);
    expect(isMessageDirection("both")).toBe(false);
  });

  it("lets her close with every ending except renewed, which only Renew sets", () => {
    expect(isCloseOption("no_reply")).toBe(true);
    expect(isCloseOption("renewed")).toBe(false);
    expect(isCloseOption("nonsense")).toBe(false);
    expect(new Set(CARE_CLOSE_OPTIONS)).toEqual(new Set(CARE_ENDED_HOW.filter((how) => how !== "renewed")));
  });

  it("has the endings the owner chose, and none he dropped", () => {
    expect([...CARE_ENDED_HOW].sort()).toEqual(["back_in_community", "handed_off", "no_reply", "ran_its_course", "renewed"]);
    expect(isCareEndedHow("friendly_contact")).toBe(false);
    expect(isCareEndedHow("asked_not_to_contact")).toBe(false);
  });

  it("lists the endings first match first, each with a label and a one-line definition", () => {
    expect(CARE_CLOSE_OPTIONS).toEqual(["handed_off", "no_reply", "back_in_community", "ran_its_course"]);
    for (const how of CARE_ENDED_HOW) {
      expect(CARE_ENDED_HOW_LABELS[how]).toBeTruthy();
      expect(CARE_ENDED_HOW_HELP[how]).toBeTruthy();
    }
    expect(CARE_ENDED_HOW_HELP.no_reply).toMatch(/never answered/);
    expect(CARE_ENDED_HOW_HELP.handed_off).toMatch(/asks you to stop/);
  });

  it("has a label and a one-line guide for every reason", () => {
    for (const reason of CARE_REASONS) {
      expect(CARE_REASON_LABELS[reason]).toBeTruthy();
      expect(CARE_REASON_HELP[reason]).toBeTruthy();
    }
  });

  it("recognizes an engagement id by its prefix and base58 characters", () => {
    expect(isCareId("care_AAAAAAAAAAA1")).toBe(true);
    expect(isCareId("care_AAAAAAAAAAA0")).toBe(false); // no 0 in base58
    expect(isCareId("conv_AAAAAAAAAAA1")).toBe(false);
    expect(isCareId(undefined)).toBe(false);
  });
});

describe("periodEndsOn", () => {
  it("counts calendar days from the Eastern day it opened on", () => {
    expect(periodEndsOn(new Date("2026-03-01T15:00:00Z"), 30)).toBe("2026-03-31");
  });

  it("uses the Eastern day on both sides of Eastern midnight, not the UTC day", () => {
    // 23:30 on Mar 1 in Eastern (EST) is 04:30 on Mar 2 in UTC.
    expect(periodEndsOn(new Date("2026-03-02T04:30:00Z"), 30)).toBe("2026-03-31");
    // 00:30 on Mar 2 in Eastern is 05:30 in UTC.
    expect(periodEndsOn(new Date("2026-03-02T05:30:00Z"), 30)).toBe("2026-04-01");
  });

  it("is not moved by a daylight saving change inside the period", () => {
    // Spring forward is Sunday Mar 8 2026, fall back Sunday Nov 1 2026: the days are 23 and 25 hours long.
    expect(periodEndsOn(new Date("2026-03-01T15:00:00Z"), 14)).toBe("2026-03-15");
    expect(periodEndsOn(new Date("2026-10-15T15:00:00Z"), 30)).toBe("2026-11-14");
  });

  it("takes the day it opened on even at the odd hours of a clock change", () => {
    expect(periodEndsOn(new Date("2026-03-08T06:30:00Z"), 0)).toBe("2026-03-08"); // 01:30 EST, half an hour before the clocks jump
    expect(periodEndsOn(new Date("2026-03-08T07:30:00Z"), 0)).toBe("2026-03-08"); // 03:30 EDT
    expect(periodEndsOn(new Date("2026-11-01T05:30:00Z"), 0)).toBe("2026-11-01"); // 01:30 EDT, the first time it is 01:30
    expect(periodEndsOn(new Date("2026-11-01T06:30:00Z"), 0)).toBe("2026-11-01"); // 01:30 EST, the second time
  });
});

describe("careStatus", () => {
  const at = (iso: string) => new Date(iso);
  const status = (over: Partial<CareTimes>, now: string) => careStatus({ ...base, ...over }, at(now), settings);

  it("is waiting after she writes, inside the period and the quiet window", () => {
    expect(status({}, "2026-03-05T15:00:00Z")).toBe("waiting");
  });

  it("is gone quiet after the quiet window of silence from both sides, to the millisecond", () => {
    expect(status({}, "2026-03-15T15:00:00.000Z")).toBe("waiting"); // exactly 14 days
    expect(status({}, "2026-03-15T15:00:00.001Z")).toBe("gone_quiet");
  });

  it("counts the quiet window from the latest message from either side", () => {
    expect(status({ last_staff_message_at: "2026-03-10T15:00:00Z" }, "2026-03-20T15:00:00Z")).toBe("waiting");
    expect(status({ last_staff_message_at: null }, "2026-03-20T15:00:00Z")).toBe("gone_quiet"); // from when it opened
  });

  it("needs her reply when the member wrote last, however long ago", () => {
    const memberLast = { last_member_message_at: "2026-03-02T10:00:00Z" };
    expect(status(memberLast, "2026-03-03T10:00:00Z")).toBe("needs_reply");
    expect(status(memberLast, "2026-03-30T10:00:00Z")).toBe("needs_reply");
  });

  it("goes back to waiting once she writes after them", () => {
    expect(status({ last_member_message_at: "2026-03-02T10:00:00Z", last_staff_message_at: "2026-03-03T10:00:00Z" }, "2026-03-04T10:00:00Z")).toBe("waiting");
  });

  it("is review due the Eastern day after the period ends, not before", () => {
    expect(status({}, "2026-04-01T03:30:00Z")).toBe("gone_quiet"); // 23:30 on Mar 31 Eastern: the last day of the period
    expect(status({}, "2026-04-01T04:30:00Z")).toBe("review_due"); // 00:30 on Apr 1 Eastern
  });

  it("is lapsed the Eastern day after the grace window, not before", () => {
    expect(status({}, "2026-04-15T03:30:00Z")).toBe("review_due"); // 23:30 on Apr 14 Eastern: the last day of the grace
    expect(status({}, "2026-04-15T04:30:00Z")).toBe("lapsed"); // 00:30 on Apr 15
  });

  it("never lapses or goes to review while the member wrote last: it stays needs_reply until she acts", () => {
    const memberLast = { last_member_message_at: "2026-03-25T10:00:00Z" };
    expect(status(memberLast, "2026-04-05T10:00:00Z")).toBe("needs_reply"); // review window
    expect(status(memberLast, "2026-09-05T10:00:00Z")).toBe("needs_reply"); // long past grace
    expect(isActiveStatus(status(memberLast, "2026-09-05T10:00:00Z"))).toBe(true);
  });

  it("follows the period end across a daylight saving change (a 23-hour and a 25-hour day)", () => {
    const march = { period_ends_on: "2026-03-08", opened_at: "2026-03-01T15:00:00Z", last_staff_message_at: "2026-03-08T00:00:00Z" };
    expect(status(march, "2026-03-09T03:59:00Z")).toBe("waiting"); // 23:59 on Mar 8 EDT
    expect(status(march, "2026-03-09T04:00:00Z")).toBe("review_due"); // 00:00 on Mar 9 EDT
    const november = { period_ends_on: "2026-11-01", opened_at: "2026-10-20T15:00:00Z", last_staff_message_at: "2026-11-01T00:00:00Z" };
    expect(status(november, "2026-11-02T04:59:00Z")).toBe("waiting"); // 23:59 on Nov 1 EST
    expect(status(november, "2026-11-02T05:00:00Z")).toBe("review_due"); // 00:00 on Nov 2 EST
  });

  it("is closed once closed, whatever else is true", () => {
    expect(status({ closed_at: "2026-03-09T09:00:00Z", last_member_message_at: "2026-03-08T10:00:00Z" }, "2027-01-01T00:00:00Z")).toBe("closed");
  });

  it("uses the configured settings when none are given", () => {
    expect(careStatus(base, new Date("2026-03-02T15:00:00Z"))).toBe("waiting");
  });

  it("counts every status but closed and lapsed as active", () => {
    expect(["needs_reply", "review_due", "waiting", "gone_quiet"].every((s) => isActiveStatus(s as never))).toBe(true);
    expect(isActiveStatus("lapsed")).toBe(false);
    expect(isActiveStatus("closed")).toBe(false);
  });
});

describe("last activity and who wrote last", () => {
  it("is the latest of opening and each side's last message", () => {
    expect(lastActivityAt(base)).toBe("2026-03-01T15:00:00.000Z");
    expect(lastActivityAt({ ...base, last_member_message_at: "2026-03-09T00:00:00Z" })).toBe("2026-03-09T00:00:00Z");
  });

  it("says the member wrote last only when their message is the latest", () => {
    expect(memberWroteLast(base)).toBe(false);
    expect(memberWroteLast({ last_staff_message_at: null, last_member_message_at: "2026-03-01T00:00:00Z" })).toBe(true);
    expect(memberWroteLast({ last_staff_message_at: "2026-03-02T00:00:00Z", last_member_message_at: "2026-03-01T00:00:00Z" })).toBe(false);
    expect(memberWroteLast({ last_staff_message_at: null, last_member_message_at: null })).toBe(false);
  });
});

describe("ordering", () => {
  const now = new Date("2026-04-05T15:00:00Z");
  const row = (id: string, over: Partial<CareTimes>) => ({ id, ...base, ...over });

  it("shows what needs her first, then review due (most overdue first), gone quiet, then waiting", () => {
    const rows = [
      row("care_AAAAAAAAAAA1", { period_ends_on: "2026-04-30" }), // waiting? she wrote Mar 1: gone quiet
      row("care_AAAAAAAAAAA2", { period_ends_on: "2026-04-30", last_staff_message_at: "2026-04-04T15:00:00Z" }), // waiting
      row("care_AAAAAAAAAAA3", { last_member_message_at: "2026-03-20T00:00:00Z" }), // needs reply
      row("care_AAAAAAAAAAA4", { period_ends_on: "2026-04-03" }), // review due
      row("care_AAAAAAAAAAA5", { period_ends_on: "2026-04-01" }), // review due, more overdue
    ];
    expect(sortActive(rows, now, settings).map((r) => r.id)).toEqual([
      "care_AAAAAAAAAAA3",
      "care_AAAAAAAAAAA5",
      "care_AAAAAAAAAAA4",
      "care_AAAAAAAAAAA1",
      "care_AAAAAAAAAAA2",
    ]);
  });

  it("puts the one waiting longest first within a status, then by id", () => {
    const rows = [
      row("care_AAAAAAAAAAA2", { period_ends_on: "2026-04-30", last_staff_message_at: "2026-04-04T15:00:00Z" }),
      row("care_AAAAAAAAAAA1", { period_ends_on: "2026-04-30", last_staff_message_at: "2026-04-04T15:00:00Z" }),
      row("care_AAAAAAAAAAA3", { period_ends_on: "2026-04-30", last_staff_message_at: "2026-04-02T15:00:00Z" }),
    ];
    expect(sortActive(rows, now, settings).map((r) => r.id)).toEqual(["care_AAAAAAAAAAA3", "care_AAAAAAAAAAA1", "care_AAAAAAAAAAA2"]);
  });

  it("orders Earlier by when each ended, closed and lapsed together, newest first", () => {
    const rows = [
      row("care_AAAAAAAAAAA1", { closed_at: "2026-02-10T15:00:00Z" }),
      row("care_AAAAAAAAAAA2", { period_ends_on: "2026-03-20" }), // lapsed: ended on its last day
      row("care_AAAAAAAAAAA3", { closed_at: "2026-03-25T15:00:00Z" }),
      row("care_AAAAAAAAAAA4", { closed_at: "2026-03-25T16:00:00Z" }), // same day: by id
    ];
    expect(sortEarlier(rows).map((r) => r.id)).toEqual(["care_AAAAAAAAAAA3", "care_AAAAAAAAAAA4", "care_AAAAAAAAAAA2", "care_AAAAAAAAAAA1"]);
  });

  it("uses the Eastern day of a closing for Earlier, so an evening close sorts with its own day", () => {
    const rows = [
      row("care_AAAAAAAAAAA1", { closed_at: "2026-03-25T15:00:00Z" }),
      row("care_AAAAAAAAAAA2", { closed_at: "2026-03-26T03:30:00Z" }), // 23:30 on Mar 25 Eastern: the same Eastern day, so by id
    ];
    expect(sortEarlier(rows).map((r) => r.id)).toEqual(["care_AAAAAAAAAAA1", "care_AAAAAAAAAAA2"]);
  });
});

describe("follow-ups and 'how long ago'", () => {
  it("is due on the Eastern day itself, not before", () => {
    expect(isFollowUpDue("2026-03-08", new Date("2026-03-08T04:59:00Z"))).toBe(false); // 23:59 on Mar 7 Eastern
    expect(isFollowUpDue("2026-03-08", new Date("2026-03-08T05:00:00Z"))).toBe(true);
    expect(isFollowUpDue(null, new Date())).toBe(false);
  });

  it("says today, yesterday or a number of days", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    expect(daysAgoLabel("2026-03-10T01:00:00Z", now)).toBe("today");
    expect(daysAgoLabel("2026-03-09T11:00:00Z", now)).toBe("yesterday");
    expect(daysAgoLabel("2026-03-05T12:00:00Z", now)).toBe("5 days ago");
  });
});

describe("careWindows", () => {
  const windowSettings = { beforeDays: 28, afterFromDays: 30, afterToDays: 60 };
  const windows = (over: Partial<CareTimes>, now: string) => careWindows({ ...base, ...over }, new Date(now), windowSettings);

  it("ends the period at the start of the Eastern day after its last day", () => {
    expect(endOfOrgDay("2026-03-31").toISOString()).toBe("2026-04-01T04:00:00.000Z"); // EDT
    expect(endOfOrgDay("2026-03-07").toISOString()).toBe("2026-03-08T05:00:00.000Z"); // EST, the day before the clocks jump
    expect(endOfOrgDay("2026-03-08").toISOString()).toBe("2026-03-09T04:00:00.000Z"); // EDT
    expect(endOfOrgDay("2026-10-31").toISOString()).toBe("2026-11-01T04:00:00.000Z"); // still EDT
    expect(endOfOrgDay("2026-11-01").toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST
  });

  it("measures before as the 28 days before it opened", () => {
    const w = windows({}, "2026-08-01T00:00:00Z");
    expect(w.before).toEqual({ name: "before", from: "2026-02-01T15:00:00.000Z", to: "2026-03-01T15:00:00.000Z", state: "complete" });
  });

  it("measures during from opening to the end of the period, and after as days 30 to 60 after it", () => {
    const w = windows({}, "2026-08-01T00:00:00Z");
    expect(w.during).toEqual({ name: "during", from: "2026-03-01T15:00:00.000Z", to: "2026-04-01T04:00:00.000Z", state: "complete" });
    expect(w.after).toEqual({ name: "after", from: "2026-05-01T04:00:00.000Z", to: "2026-05-31T04:00:00.000Z", state: "complete" });
  });

  it("ends during when she closed it, if that was sooner, and still anchors after on the period", () => {
    const w = windows({ closed_at: "2026-03-10T15:00:00Z" }, "2026-08-01T00:00:00Z");
    expect(w.during).toMatchObject({ to: "2026-03-10T15:00:00.000Z", state: "complete" });
    expect(w.after.from).toBe("2026-05-01T04:00:00.000Z");
  });

  it("counts during so far while the period is still running", () => {
    const w = windows({}, "2026-03-10T12:00:00Z");
    expect(w.during).toMatchObject({ from: "2026-03-01T15:00:00.000Z", to: "2026-03-10T12:00:00.000Z", state: "so_far" });
    expect(w.after.state).toBe("not_yet");
  });

  it("is not yet for after until the whole window has passed, one millisecond either side", () => {
    expect(windows({}, "2026-05-31T03:59:59.999Z").after.state).toBe("not_yet");
    expect(windows({}, "2026-05-31T04:00:00.000Z").after.state).toBe("complete");
  });

  it("is complete for during the moment the period is over", () => {
    expect(windows({}, "2026-04-01T03:59:59.999Z").during.state).toBe("so_far");
    expect(windows({}, "2026-04-01T04:00:00.000Z").during.state).toBe("complete");
  });

  it("takes after by Eastern calendar day across a daylight saving change", () => {
    // A period ending Mar 7: day 30 after is Apr 7 (EDT), day 60 is May 7 (EDT); the period's own end is in EST.
    const w = windows({ period_ends_on: "2026-03-07" }, "2027-01-01T00:00:00Z");
    expect(w.during.to).toBe("2026-03-08T05:00:00.000Z");
    expect(w.after.from).toBe("2026-04-07T04:00:00.000Z");
    // And across the fall change: a period ending Oct 31 has its day 30 on Dec 1 (EST) and day 60 on Dec 31 (EST).
    const fall = windows({ period_ends_on: "2026-10-31", opened_at: "2026-10-01T15:00:00Z" }, "2027-06-01T00:00:00Z");
    expect(fall.after).toMatchObject({ from: "2026-12-01T05:00:00.000Z", to: "2026-12-31T05:00:00.000Z" });
  });

  it("uses the configured window lengths when none are given", () => {
    const w = careWindows(base, new Date("2027-01-01T00:00:00Z"));
    expect(Date.parse(w.before.to) - Date.parse(w.before.from)).toBe(CARE_BEFORE_DAYS * 86_400_000);
  });

  it("never lets during run backwards if the clock is before the opening", () => {
    const w = windows({}, "2026-02-01T00:00:00Z");
    expect(Date.parse(w.during.to)).toBeGreaterThanOrEqual(Date.parse(w.during.from));
  });
});

describe("periodNumber", () => {
  const rows = new Map([
    ["care_AAAAAAAAAAA1", { renewed_from: null }],
    ["care_AAAAAAAAAAA2", { renewed_from: "care_AAAAAAAAAAA1" }],
    ["care_AAAAAAAAAAA3", { renewed_from: "care_AAAAAAAAAAA2" }],
    ["care_AAAAAAAAAAA4", { renewed_from: "care_ZZZZZZZZZZZZ" }], // renewed from one that is gone
    ["care_AAAAAAAAAAA5", { renewed_from: "care_AAAAAAAAAAA6" }], // a cycle
    ["care_AAAAAAAAAAA6", { renewed_from: "care_AAAAAAAAAAA5" }],
  ]);
  const of = (id: string) => periodNumber({ id, renewed_from: rows.get(id)!.renewed_from }, rows);

  it("counts the chain of renewals, the first being period 1", () => {
    expect([of("care_AAAAAAAAAAA1"), of("care_AAAAAAAAAAA2"), of("care_AAAAAAAAAAA3")]).toEqual([1, 2, 3]);
  });

  it("stops at an ancestor that is not among the rows, and at a cycle", () => {
    expect(of("care_AAAAAAAAAAA4")).toBe(1);
    expect(of("care_AAAAAAAAAAA5")).toBe(2);
  });
});

describe("careCheckpoints", () => {
  const ends = { period_ends_on: "2026-03-31" };

  it("reads the checkpoint days from config, soonest first, each an Eastern calendar day after the period's last day", () => {
    const checkpoints = careCheckpoints(ends, new Date("2030-01-01T00:00:00Z"));
    expect(checkpoints.map((c) => c.days)).toEqual([...CARE_RETENTION_CHECKPOINT_DAYS].sort((a, b) => a - b));
    expect(CARE_RETENTION_CHECKPOINT_DAYS.length).toBeGreaterThan(0);
  });

  it("starts the day after the last day plus N days, in Eastern time, across daylight saving", () => {
    const [d60, d90, d180] = careCheckpoints(ends, new Date("2030-01-01T00:00:00Z"), [180, 60, 90]);
    expect(d60.at.toISOString()).toBe("2026-05-31T04:00:00.000Z"); // Mar 31 + 61 days, EDT
    expect(d90.at.toISOString()).toBe("2026-06-30T04:00:00.000Z");
    expect(d180.at.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    // a period ending Aug 31 has its day 90 on Nov 30 (EST: the clocks changed in between), the 91st day counting from the day after
    expect(careCheckpoints({ period_ends_on: "2026-08-31" }, new Date("2030-01-01T00:00:00Z"), [90])[0].at.toISOString()).toBe("2026-11-30T05:00:00.000Z");
  });

  it("is not yet until the moment, to the millisecond", () => {
    expect(careCheckpoints(ends, new Date("2026-05-31T03:59:59.999Z"), [60])[0].state).toBe("not_yet");
    expect(careCheckpoints(ends, new Date("2026-05-31T04:00:00.000Z"), [60])[0].state).toBe("complete");
  });
});

describe("commitmentLength", () => {
  it("says days for a short program and months from two months on, from the cohort's own dates", () => {
    expect(commitmentLength("2026-03-01", "2026-03-15")).toBe("14 days");
    expect(commitmentLength("2026-03-01", "2026-03-02")).toBe("1 day");
    expect(commitmentLength("2026-03-01", "2026-08-28")).toBe("6 months");
    expect(commitmentLength("2026-01-01", "2026-12-31")).toBe("12 months");
    expect(commitmentLength("2026-05-01", "2026-04-01")).toBe("0 days");
  });
});

describe("planOrdinal", () => {
  it("says first to tenth in words and numbers after that", () => {
    expect([1, 2, 3, 10].map(planOrdinal)).toEqual(["first", "second", "third", "tenth"]);
    expect([11, 12, 13, 21, 22, 23, 24, 101].map(planOrdinal)).toEqual(["11th", "12th", "13th", "21st", "22nd", "23rd", "24th", "101st"]);
  });
});

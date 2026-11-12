import { describe, expect, it } from "vitest";
import { careOwnerOf, derivedMessageTimes, dmCountsFrom, followsTrackedDm, lastWriter, membersWhoseNewCareFollowsDm } from "@/lib/care-dm-rules";

const engagement = (over: Partial<{ opened_at: string; last_staff_message_at: string | null; last_member_message_at: string | null }> = {}) => ({
  opened_at: "2026-03-10T15:00:00.000Z", // 11:00 Eastern (daylight time)
  last_staff_message_at: "2026-03-10T15:00:00.000Z",
  last_member_message_at: null,
  ...over,
});

describe("dmCountsFrom: the start of the Eastern day the engagement opened", () => {
  it.each([
    ["an ordinary winter day", "2026-01-15T15:00:00.000Z", "2026-01-15T05:00:00.000Z"],
    ["an ordinary summer day", "2026-07-15T15:00:00.000Z", "2026-07-15T04:00:00.000Z"],
    ["just before Eastern midnight (still the same day)", "2026-07-16T03:59:00.000Z", "2026-07-15T04:00:00.000Z"],
    ["just after Eastern midnight (the next day)", "2026-07-16T04:30:00.000Z", "2026-07-16T04:00:00.000Z"],
    ["an evening that is already tomorrow in UTC", "2026-01-16T03:30:00.000Z", "2026-01-15T05:00:00.000Z"],
    // The second Sunday of March: the day is 23 hours long and starts on standard time.
    ["the spring clock change, before the change", "2026-03-08T06:30:00.000Z", "2026-03-08T05:00:00.000Z"],
    ["the spring clock change, after the change", "2026-03-09T03:30:00.000Z", "2026-03-08T05:00:00.000Z"],
    ["the day after the spring change", "2026-03-09T04:30:00.000Z", "2026-03-09T04:00:00.000Z"],
    // The first Sunday of November: the day is 25 hours long and starts on daylight time.
    ["the autumn clock change, before the change", "2026-11-01T05:30:00.000Z", "2026-11-01T04:00:00.000Z"],
    ["the autumn clock change, after the change", "2026-11-02T04:30:00.000Z", "2026-11-01T04:00:00.000Z"],
    ["the day after the autumn change", "2026-11-02T05:30:00.000Z", "2026-11-02T05:00:00.000Z"],
  ])("%s", (_label, openedAt, from) => {
    expect(dmCountsFrom(openedAt).toISOString()).toBe(from);
    expect(dmCountsFrom(new Date(openedAt)).toISOString()).toBe(from);
  });
});

describe("derivedMessageTimes", () => {
  it("counts a message sent earlier the same Eastern day, but not one from the day before", () => {
    const e = engagement(); // opened 11:00 Eastern on March 10: the day starts at 04:00Z
    expect(derivedMessageTimes(e, { staffAt: null, memberAt: "2026-03-10T04:00:00.000Z" })).toEqual({ memberAt: "2026-03-10T04:00:00.000Z" });
    expect(derivedMessageTimes(e, { staffAt: null, memberAt: "2026-03-10T03:59:59.000Z" })).toEqual({});
  });

  it("counts a message at the start of a 23-hour day and refuses the one a second before it", () => {
    const e = engagement({ opened_at: "2026-03-08T16:00:00.000Z", last_staff_message_at: null }); // noon Eastern on the spring change day
    expect(derivedMessageTimes(e, { staffAt: "2026-03-08T05:00:00.000Z", memberAt: "2026-03-08T04:59:59.000Z" })).toEqual({ staffAt: "2026-03-08T05:00:00.000Z" });
  });

  it("counts a message at the start of a 25-hour day and refuses the one a second before it", () => {
    const e = engagement({ opened_at: "2026-11-01T17:00:00.000Z", last_staff_message_at: null });
    expect(derivedMessageTimes(e, { staffAt: "2026-11-01T04:00:00.000Z", memberAt: "2026-11-01T03:59:59.000Z" })).toEqual({ staffAt: "2026-11-01T04:00:00.000Z" });
  });

  it("only moves a time forward: older or equal times, by the instant and not the text, change nothing", () => {
    const e = engagement({ last_staff_message_at: "2026-03-12T10:00:00.000Z", last_member_message_at: "2026-03-13T10:00:00.000Z" });
    expect(derivedMessageTimes(e, { staffAt: "2026-03-11T10:00:00.000Z", memberAt: "2026-03-13T10:00:00.000Z" })).toEqual({});
    // The database writes the same instant as +00:00.
    expect(derivedMessageTimes(e, { staffAt: "2026-03-12T10:00:00+00:00", memberAt: null })).toEqual({});
    expect(derivedMessageTimes(e, { staffAt: "2026-03-14T10:00:00.000Z", memberAt: "2026-03-13T10:00:00.001Z" })).toEqual({
      staffAt: "2026-03-14T10:00:00.000Z",
      memberAt: "2026-03-13T10:00:00.001Z",
    });
  });

  it("is idempotent: applying what it returned leaves nothing more to apply", () => {
    const writes = { staffAt: "2026-03-14T10:00:00.000Z", memberAt: "2026-03-15T10:00:00.000Z" };
    const first = derivedMessageTimes(engagement(), writes);
    expect(first).toEqual(writes);

    const moved = engagement({ last_staff_message_at: first.staffAt, last_member_message_at: first.memberAt });
    expect(derivedMessageTimes(moved, writes)).toEqual({});
  });

  it("sets a side that has nothing stored, and does nothing for a side Bronze has nothing for", () => {
    expect(derivedMessageTimes(engagement({ last_staff_message_at: null }), { staffAt: null, memberAt: null })).toEqual({});
    expect(derivedMessageTimes(engagement({ last_staff_message_at: null }), { staffAt: "2026-03-10T16:00:00.000Z", memberAt: null })).toEqual({ staffAt: "2026-03-10T16:00:00.000Z" });
  });
});

describe("lastWriter", () => {
  it("says who wrote last and when", () => {
    expect(lastWriter({ staffAt: "2026-03-01T10:00:00.000Z", memberAt: "2026-03-02T10:00:00.000Z" })).toEqual({ who: "member", at: "2026-03-02T10:00:00.000Z" });
    expect(lastWriter({ staffAt: "2026-03-03T10:00:00.000Z", memberAt: "2026-03-02T10:00:00.000Z" })).toEqual({ who: "staff", at: "2026-03-03T10:00:00.000Z" });
    expect(lastWriter({ staffAt: "2026-03-03T10:00:00.000Z", memberAt: null })).toEqual({ who: "staff", at: "2026-03-03T10:00:00.000Z" });
    expect(lastWriter({ staffAt: null, memberAt: "2026-03-03T10:00:00.000Z" })).toEqual({ who: "member", at: "2026-03-03T10:00:00.000Z" });
  });

  it("is null when neither has written, and names her on a tie", () => {
    expect(lastWriter({ staffAt: null, memberAt: null })).toBeNull();
    expect(lastWriter({ staffAt: "2026-03-03T10:00:00.000Z", memberAt: "2026-03-03T10:00:00.000Z" })?.who).toBe("staff");
  });
});

describe("followsTrackedDm: whose DM fills in an engagement", () => {
  const ME = "user-staff-1";
  const tracked = { userId: ME, memberIds: new Set(["mbr_AAAAAAAAAAA1"]) };
  const base = { channel: "slack_dm", member_id: "mbr_AAAAAAAAAAA1", owned_by: ME, opened_by: "user-other" };

  it("is true for a Slack DM care period she owns with a member whose DM she tracks", () => {
    expect(followsTrackedDm(base, tracked)).toBe(true);
  });

  it("takes the opener as the owner when nobody owns it", () => {
    expect(careOwnerOf({ owned_by: null, opened_by: ME })).toBe(ME);
    expect(followsTrackedDm({ ...base, owned_by: null, opened_by: ME }, tracked)).toBe(true);
    expect(followsTrackedDm({ ...base, owned_by: null, opened_by: "user-other" }, tracked)).toBe(false);
  });

  it("is false for another channel, another owner, or a member whose DM is not tracked", () => {
    expect(followsTrackedDm({ ...base, channel: "email" }, tracked)).toBe(false);
    expect(followsTrackedDm({ ...base, channel: "prickle" }, tracked)).toBe(false);
    expect(followsTrackedDm({ ...base, owned_by: "user-other" }, tracked)).toBe(false);
    expect(followsTrackedDm({ ...base, member_id: "mbr_AAAAAAAAAAA2" }, tracked)).toBe(false);
  });
});

describe("membersWhoseNewCareFollowsDm: a new period takes the latest one's owner", () => {
  const ME = "user-staff-1";
  const A = "mbr_AAAAAAAAAAA1";
  const B = "mbr_AAAAAAAAAAA2";
  const period = (id: string, member_id: string, owned_by: string | null, opened_at: string) => ({ id, member_id, owned_by, opened_at });

  it("counts a tracked member with no care period yet, since she would own it", () => {
    expect([...membersWhoseNewCareFollowsDm(ME, new Set([A]), [])]).toEqual([A]);
  });

  it("counts a member whose latest period is hers, however old the earlier ones, and not one whose latest belongs to someone else", () => {
    const rows = [
      period("care_1", A, "user-other", "2026-01-01T15:00:00.000Z"),
      period("care_2", A, ME, "2026-02-01T15:00:00.000Z"),
      period("care_3", B, ME, "2026-01-01T15:00:00.000Z"),
      period("care_4", B, "user-other", "2026-02-01T15:00:00.000Z"),
    ];
    expect([...membersWhoseNewCareFollowsDm(ME, new Set([A, B]), rows)]).toEqual([A]);
  });

  it("treats a latest period with no owner as hers, like the start action, and ignores members she does not track", () => {
    expect([...membersWhoseNewCareFollowsDm(ME, new Set([A]), [period("care_1", A, null, "2026-01-01T15:00:00.000Z"), period("care_2", B, "user-other", "2026-01-01T15:00:00.000Z")])]).toEqual([A]);
  });
});

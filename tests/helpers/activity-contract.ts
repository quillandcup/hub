import { describe, it, expect, beforeEach } from "vitest";
import type { ActivityRepository, NewActivity } from "@/lib/data/activities";

export type ActivityContractContext = {
  repo: () => ActivityRepository;
  memberIds: readonly [string, string];
  /** A string no other run has used (related ids of the deduplicated sources are unique across the table). */
  unique: (label: string) => string;
  /** Removes the two members' activities. */
  clear: () => Promise<void>;
};

/** Behavior every `ActivityRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineActivityContract(name: string, setup: () => ActivityContractContext) {
  describe(`${name} (ActivityRepository contract)`, () => {
    let ctx: ActivityContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const activity = (member: 0 | 1, extra: Partial<NewActivity> = {}): NewActivity => ({
      memberId: ctx.memberIds[member],
      type: "writing_progress_logged",
      category: "writing",
      title: "Logged writing progress",
      occurredAt: "2097-02-01T10:00:00Z",
      source: "writing_progress",
      ...extra,
    });

    it("records an activity and removes what a source wrote for one related id", async () => {
      const related = ctx.unique("entry");
      expect(await ctx.repo().record(activity(0, { relatedId: related, engagementValue: 5 }))).toBe(true);
      await ctx.repo().record(activity(0, { relatedId: ctx.unique("other") }));

      expect(await ctx.repo().relatedIdsWritten("writing_progress", [related, "nope"])).toEqual(new Set([related]));
      await ctx.repo().removeFor("writing_progress", related);
      await ctx.repo().removeFor("some_other_source", ctx.unique("none"));
      expect(await ctx.repo().relatedIdsWritten("writing_progress", [related])).toEqual(new Set());
    });

    it("keeps one row per login session and one per member, type and related id for courses; a repeat is a no-op", async () => {
      const session = ctx.unique("session");
      const login = activity(0, { type: "hedgie_hub_login", category: "engagement", source: "access_events", relatedId: session });
      expect(await ctx.repo().record(login)).toBe(true);
      expect(await ctx.repo().record({ ...login, memberId: ctx.memberIds[1] })).toBe(false);

      const lesson = ctx.unique("lesson");
      const watched = activity(0, { type: "lesson_watched", category: "learning", source: "courses", relatedId: lesson });
      expect(await ctx.repo().record(watched)).toBe(true);
      expect(await ctx.repo().record(watched)).toBe(false);
      expect(await ctx.repo().record({ ...watched, type: "lesson_completed" })).toBe(true);
      expect(await ctx.repo().record({ ...watched, memberId: ctx.memberIds[1] })).toBe(true);
    });

    it("records several at once, all or nothing", async () => {
      const [a, b, c] = [ctx.unique("s1"), ctx.unique("s2"), ctx.unique("s3")];
      const login = (related: string) => activity(0, { type: "hedgie_hub_login", category: "engagement", source: "access_events", relatedId: related });

      expect(await ctx.repo().recordMany([])).toBe(0);
      expect(await ctx.repo().recordMany([login(a), login(b)])).toBe(2);
      await expect(ctx.repo().recordMany([login(c), login(a)])).rejects.toThrow();

      expect(await ctx.repo().relatedIdsWritten("access_events", [a, b, c])).toEqual(new Set([a, b]));
    });

    it("moves a member's activities to another member", async () => {
      await ctx.repo().record(activity(0, { type: "prickle_attended", category: "event", source: "prickle_attendance", relatedId: ctx.unique("p") }));

      await ctx.repo().reassign(ctx.memberIds[0], ctx.memberIds[1]);

      expect(await ctx.repo().prickleAttendances(ctx.memberIds[0])).toEqual([]);
      expect((await ctx.repo().prickleAttendances(ctx.memberIds[1])).map((r) => r.member_id)).toEqual([ctx.memberIds[1]]);
    });

    it("reads a member's attendances and recent activity for their engagement metrics", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.repo().record(activity(0, { type: "prickle_attended", category: "event", source: "prickle_attendance", occurredAt: "2097-01-05T10:00:00Z", engagementValue: 3 }));
      await ctx.repo().record(activity(0, { occurredAt: "2097-02-20T10:00:00Z", engagementValue: 5 }));
      await ctx.repo().record(activity(1, { occurredAt: "2097-02-21T10:00:00Z" }));

      expect(await ctx.repo().prickleAttendances(a)).toEqual([{ member_id: a, occurred_at: expect.stringContaining("2097-01-05") }]);
      const recent = await ctx.repo().engagementSince(a, "2097-02-01T00:00:00Z");
      expect(recent).toEqual([{ member_id: a, activity_type: "writing_progress_logged", engagement_value: 5, occurred_at: expect.stringContaining("2097-02-20") }]);
      expect(await ctx.repo().engagementSince(b, "2098-01-01T00:00:00Z")).toEqual([]);
    });

    it("reads Slack activity: counts since a time, a member's feed newest first, the last write, and who introduced themselves", async () => {
      const [a, b] = ctx.memberIds;
      const slack = (member: 0 | 1, at: string, extra: Partial<NewActivity> = {}) =>
        activity(member, { type: "slack_message", category: "communication", source: "slack", occurredAt: at, relatedId: ctx.unique("m"), ...extra });
      await ctx.repo().record(slack(0, "2097-03-01T10:00:00Z", { data: { channel_name: "start-here" }, title: "first" }));
      await ctx.repo().record(slack(0, "2097-03-05T10:00:00Z", { data: { channel_name: "random" }, title: "second" }));
      await ctx.repo().record(slack(1, "2097-03-06T10:00:00Z", { data: { channel_name: "random" } }));
      await ctx.repo().record(slack(1, "2097-01-01T10:00:00Z"));
      // A reply in the same channel is not an introduction.
      await ctx.repo().record(slack(1, "2097-03-07T10:00:00Z", { type: "slack_thread_reply", data: { channel_name: "start-here" } }));

      const counts = await ctx.repo().slackCountsSince("2097-02-01T00:00:00Z");
      expect([counts.get(a), counts.get(b)]).toEqual([2, 2]);

      expect((await ctx.repo().slackFeed(a, 10)).map((r) => r.title)).toEqual(["second", "first"]);
      expect((await ctx.repo().slackFeed(a, 1)).map((r) => r.title)).toEqual(["second"]);

      expect(await ctx.repo().lastSlackWriteAt()).toEqual(expect.any(String));
      expect(await ctx.repo().introducedIn([a, b], "start-here")).toEqual(new Set([a]));
      expect(await ctx.repo().introducedIn([], "start-here")).toEqual(new Set());
    });
  });
}

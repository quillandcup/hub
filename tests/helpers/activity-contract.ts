import { describe, it, expect, beforeEach } from "vitest";
import type { ActivityRepository, NewActivity } from "@/lib/data/activities";
import type { SlackPageQuery } from "@/lib/slack-activity-table";

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

    it("moves the day of the rows a source wrote for one related id, of the given types only, and says how many moved", async () => {
      const [related, other] = [ctx.unique("move"), ctx.unique("move-other")];
      const row = (extra: Partial<NewActivity>) => activity(0, { occurredAt: "2097-02-01T10:00:00Z", engagementValue: 5, ...extra });
      await ctx.repo().record(row({ relatedId: related, type: "writing_progress_logged" }));
      await ctx.repo().record(row({ relatedId: related, type: "writing_goal_set" })); // another type of the same thing
      await ctx.repo().record(row({ relatedId: other })); // another thing
      await ctx.repo().record(row({ relatedId: related, source: "some_other_source" })); // another source

      expect(await ctx.repo().moveOccurredAt("writing_progress", related, ["writing_progress_logged"], "2097-01-20T10:00:00Z")).toBe(1);
      expect(await ctx.repo().moveOccurredAt("writing_progress", ctx.unique("none"), ["writing_progress_logged"], "2097-01-20T10:00:00Z")).toBe(0);
      expect(await ctx.repo().moveOccurredAt("writing_progress", related, [], "2097-01-20T10:00:00Z")).toBe(0);

      const rows = await ctx.repo().engagementRowsForWindows([{ memberId: ctx.memberIds[0], endIso: "2097-02-10T00:00:00Z" }]);
      const days = (rows.get(`${ctx.memberIds[0]}|2097-02-10T00:00:00.000Z`) ?? []).map((r) => `${r.activity_type}@${r.occurred_at.slice(0, 10)}`).sort();
      expect(days.filter((d) => d.startsWith("writing_progress_logged@2097-01-20"))).toHaveLength(1);
      expect(days.filter((d) => d.startsWith("writing_progress_logged@2097-02-01"))).toHaveLength(2); // the other thing's and the other source's
      expect(days.filter((d) => d.startsWith("writing_goal_set@2097-02-01"))).toHaveLength(1);
    });

    it("removes what a source wrote for several related ids at once, and only that source's", async () => {
      const [a, b, keep] = [ctx.unique("many1"), ctx.unique("many2"), ctx.unique("many3")];
      for (const related of [a, b, keep]) await ctx.repo().record(activity(0, { relatedId: related }));
      await ctx.repo().record(activity(0, { relatedId: a, source: "some_other_source" }));

      await ctx.repo().removeForMany("writing_progress", [a, b, "nope"]);
      await ctx.repo().removeForMany("writing_progress", []);

      expect(await ctx.repo().relatedIdsWritten("writing_progress", [a, b, keep])).toEqual(new Set([keep]));
      expect(await ctx.repo().relatedIdsWritten("some_other_source", [a])).toEqual(new Set([a]));
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

      const query = (extra: Partial<SlackPageQuery> = {}): SlackPageQuery => ({ kind: "all", channel: null, sort: { column: "date", direction: "desc" }, page: 1, pageSize: 10, ...extra });
      expect((await ctx.repo().slackPage(a, query())).rows.map((r) => r.title)).toEqual(["second", "first"]);
      expect((await ctx.repo().slackPage(a, query({ pageSize: 1 }))).rows.map((r) => r.title)).toEqual(["second"]);

      await ctx.repo().record(slack(0, "2097-03-06T10:00:00Z", { type: "slack_reaction", data: { channel_name: "random" } }));
      // Filter by kind and channel, sort by channel then date, page, and clamp a page past the end.
      const all = await ctx.repo().slackPage(a, query());
      expect([all.total, all.page]).toEqual([3, 1]);
      expect((await ctx.repo().slackPage(a, query({ kind: "reactions" }))).total).toBe(1);
      expect((await ctx.repo().slackPage(a, query({ kind: "messages" }))).total).toBe(2);
      expect((await ctx.repo().slackPage(a, query({ channel: "random" }))).rows.map((r) => r.title)).toEqual(["Logged writing progress", "second"]);
      expect((await ctx.repo().slackPage(a, query({ kind: "messages", sort: { column: "channel", direction: "asc" } }))).rows.map((r) => r.title)).toEqual(["second", "first"]);
      const last = await ctx.repo().slackPage(a, query({ pageSize: 2, page: 9 }));
      expect([last.page, last.rows.length]).toEqual([2, 1]);
      expect(await ctx.repo().slackChannels(a)).toEqual([{ name: "random", count: 2 }, { name: "start-here", count: 1 }]);
      expect(await ctx.repo().slackSummary(a, "2097-03-02T00:00:00Z")).toEqual({ total: 3, messages: 2, reactions: 1, channels: 2, last30Days: 2 });

      expect(await ctx.repo().lastSlackWriteAt()).toEqual(expect.any(String));
      expect(await ctx.repo().introducedIn([a, b], "start-here")).toEqual(new Set([a]));
      expect(await ctx.repo().introducedIn([], "start-here")).toEqual(new Set());
    });

    describe("what a member did in a stretch of time", () => {
      const prickle = (member: 0 | 1, at: string, prickleId: string) =>
        activity(member, { type: "prickle_attended", category: "event", source: "prickle_attendance", occurredAt: at, relatedId: prickleId });
      const post = (member: 0 | 1, at: string, type = "slack_message") =>
        activity(member, { type, category: "communication", source: "slack", occurredAt: at, relatedId: ctx.unique("post") });

      it("counts distinct prickles and Slack messages from the start up to, not including, the end", async () => {
        const [a, b] = ctx.memberIds;
        const [p1, p2, p3] = [ctx.unique("prkl"), ctx.unique("prkl"), ctx.unique("prkl")];
        await ctx.repo().record(prickle(0, "2097-04-01T00:00:00Z", p1)); // on the start: counted
        await ctx.repo().record(prickle(0, "2097-04-02T10:00:00Z", p1)); // the same prickle again (left and rejoined): once
        await ctx.repo().record(prickle(0, "2097-04-10T10:00:00Z", p2));
        await ctx.repo().record(prickle(0, "2097-05-01T00:00:00Z", p3)); // on the end: not counted
        await ctx.repo().record(prickle(0, "2097-03-31T23:59:59Z", ctx.unique("prkl"))); // just before: not counted
        await ctx.repo().record(post(0, "2097-04-05T10:00:00Z"));
        await ctx.repo().record(post(0, "2097-04-06T10:00:00Z", "slack_thread_reply"));
        await ctx.repo().record(post(0, "2097-04-07T10:00:00Z", "slack_reaction")); // a reaction is not a message
        await ctx.repo().record(post(1, "2097-04-05T10:00:00Z")); // someone else
        await ctx.repo().record(activity(0, { occurredAt: "2097-04-08T10:00:00Z" })); // another kind of activity

        expect(await ctx.repo().countsBetween(a, "2097-04-01T00:00:00Z", "2097-05-01T00:00:00Z")).toEqual({ pricklesAttended: 2, slackMessages: 2 });
        expect(await ctx.repo().countsBetween(b, "2097-04-01T00:00:00Z", "2097-05-01T00:00:00Z")).toEqual({ pricklesAttended: 0, slackMessages: 1 });
        expect(await ctx.repo().countsBetween(a, "2098-01-01T00:00:00Z", "2098-02-01T00:00:00Z")).toEqual({ pricklesAttended: 0, slackMessages: 0 });
        expect(await ctx.repo().countsBetween(a, "2097-05-01T00:00:00Z", "2097-04-01T00:00:00Z")).toEqual({ pricklesAttended: 0, slackMessages: 0 });
      });

      it("counts past 1000 rows in a window", async () => {
        const a = ctx.memberIds[0];
        const start = Date.parse("2097-06-01T00:00:00Z");
        const rows = Array.from({ length: 1205 }, (_, i) => post(0, new Date(start + i * 60_000).toISOString()));
        await ctx.repo().recordMany(rows);
        await ctx.repo().record(post(0, "2097-06-03T00:00:00Z")); // outside

        expect(await ctx.repo().countsBetween(a, "2097-06-01T00:00:00Z", "2097-06-02T00:00:00Z")).toEqual({ pricklesAttended: 0, slackMessages: 1205 });
      });

      it("counts a window's activity for a score: the 30 days up to its end, both ends included, rows worth nothing left out", async () => {
        const [a, b] = ctx.memberIds;
        const row = (member: 0 | 1, at: string, points: number, type = "slack_message") =>
          activity(member, { type, category: "communication", source: "slack", occurredAt: at, relatedId: ctx.unique("pts"), engagementValue: points });
        await ctx.repo().record(row(0, "2097-07-01T00:00:00Z", 3)); // exactly 30 days before the end: in
        await ctx.repo().record(row(0, "2097-06-30T23:59:59Z", 5)); // a second before: out
        await ctx.repo().record(row(0, "2097-07-15T10:00:00Z", 10, "prickle_attended"));
        await ctx.repo().record(row(0, "2097-07-31T00:00:00Z", 2)); // exactly the end: in
        await ctx.repo().record(row(0, "2097-07-31T00:00:01Z", 7)); // after the end: out
        await ctx.repo().record(row(0, "2097-07-20T10:00:00Z", 0)); // worth nothing
        await ctx.repo().record(row(1, "2097-07-20T10:00:00Z", 4)); // someone else

        const rows = await ctx.repo().engagementRowsForWindows([
          { memberId: a, endIso: "2097-07-31T00:00:00Z" },
          { memberId: a, endIso: "2097-07-31T00:00:00.000Z" }, // the same window, written another way
          { memberId: a, endIso: "2097-07-16T00:00:00Z" },
          { memberId: b, endIso: "2097-07-31T00:00:00Z" },
        ]);

        const points = (member: string, end: string) => (rows.get(`${member}|${new Date(end).toISOString()}`) ?? []).map((r) => r.engagement_value ?? 0).sort((x, y) => x - y);
        expect(points(a, "2097-07-31T00:00:00Z")).toEqual([2, 3, 10]);
        expect(points(a, "2097-07-16T00:00:00Z")).toEqual([3, 5, 10]); // a different window sees the one the first left out
        expect(points(b, "2097-07-31T00:00:00Z")).toEqual([4]);
        expect((await ctx.repo().engagementRowsForWindows([])).size).toBe(0);
      });

      it("reads the rows of more than one request's worth of windows, and past 1000 rows", async () => {
        const [a, b] = ctx.memberIds;
        const start = Date.parse("2097-08-01T00:00:00Z");
        await ctx.repo().recordMany(
          Array.from({ length: 1205 }, (_, i) =>
            activity(0, { type: "slack_message", category: "communication", source: "slack", occurredAt: new Date(start + i * 60_000).toISOString(), relatedId: ctx.unique("bulk"), engagementValue: 1 })
          )
        );
        await ctx.repo().record(activity(1, { occurredAt: "2097-08-01T10:00:00Z", engagementValue: 6 }));
        // 45 windows over two members: more than fit in one request.
        const requests = Array.from({ length: 45 }, (_, i) => ({ memberId: i % 2 === 0 ? a : b, endIso: new Date(start + (i + 1) * 3_600_000 * 24).toISOString() }));

        const rows = await ctx.repo().engagementRowsForWindows(requests);

        expect(rows.size).toBe(45);
        expect(rows.get(`${a}|${requests[0].endIso}`)).toHaveLength(1205);
        expect(rows.get(`${b}|${requests[1].endIso}`)).toHaveLength(1);
      });

      describe("the last thing a member did themselves", () => {
        const NOW = new Date("2097-09-30T12:00:00Z");
        const own = (member: 0 | 1, type: string, at: string, over: Partial<NewActivity> = {}) =>
          activity(member, { type, category: "event", source: over.source ?? "prickle_attendance", occurredAt: at, relatedId: ctx.unique("part"), actorKind: "member", ...over });

        it("finds each member's latest participation of any kind, and nothing for a member with none", async () => {
          const [a, b] = ctx.memberIds;
          await ctx.repo().record(own(0, "prickle_attended", "2097-09-20T10:00:00Z"));
          await ctx.repo().record(own(0, "slack_message", "2097-09-25T10:00:00Z", { source: "slack" }));
          await ctx.repo().record(own(0, "lesson_completed", "2097-09-22T10:00:00Z", { source: "courses" }));

          const found = await ctx.repo().lastParticipation([a, b], NOW);

          expect(found.get(a)).toMatchObject({ type: "slack_message", label: "a Slack message" });
          expect(new Date(found.get(a)!.occurredAt).toISOString()).toBe("2097-09-25T10:00:00.000Z");
          expect(found.has(b)).toBe(false);
          expect((await ctx.repo().lastParticipation([], NOW)).size).toBe(0);
        });

        it("does not count logins, what staff or the system wrote, or anything after now", async () => {
          const [a] = ctx.memberIds;
          await ctx.repo().record(own(0, "prickle_attended", "2097-09-01T10:00:00Z"));
          await ctx.repo().record(own(0, "hedgie_hub_login", "2097-09-10T10:00:00Z", { source: "access_events" }));
          await ctx.repo().record(own(0, "feedback_submitted", "2097-09-11T10:00:00Z", { source: "feedback" }));
          await ctx.repo().record(own(0, "prickle_checkin_cleared", "2097-09-12T10:00:00Z", { source: "prickle_checkins" }));
          await ctx.repo().record(own(0, "prickle_commitment_created", "2097-09-13T10:00:00Z", { source: "prickle_commitments", actorKind: "staff" }));
          await ctx.repo().record(own(0, "care_started", "2097-09-14T10:00:00Z", { source: "care", actorKind: "staff" }));
          await ctx.repo().record(own(0, "email_sent", "2097-09-15T10:00:00Z", { source: "resend", actorKind: "system" }));
          await ctx.repo().record(own(0, "slack_message", "2097-10-05T10:00:00Z", { source: "slack" })); // after now

          const found = await ctx.repo().lastParticipation([a], NOW);

          expect(found.get(a)).toMatchObject({ type: "prickle_attended" });
          expect(new Date(found.get(a)!.occurredAt).toISOString()).toBe("2097-09-01T10:00:00.000Z");
        });

        it("still finds a member whose last participation is long ago, and reads past 1000 rows in a window", async () => {
          const [a, b] = ctx.memberIds;
          await ctx.repo().record(own(0, "prickle_attended", "2093-02-01T10:00:00Z")); // years before now
          const start = Date.parse("2097-09-29T00:00:00Z");
          await ctx.repo().recordMany(
            Array.from({ length: 1205 }, (_, i) =>
              own(1, "slack_reaction", new Date(start + i * 60_000).toISOString(), { source: "slack", category: "communication" })
            )
          );

          const found = await ctx.repo().lastParticipation([a, b], NOW);

          expect(new Date(found.get(a)!.occurredAt).toISOString()).toBe("2093-02-01T10:00:00.000Z");
          expect(new Date(found.get(b)!.occurredAt).toISOString()).toBe(new Date(start + 1204 * 60_000).toISOString());
        });
      });

      it("finds the first prickle and the first Slack post, whatever the date", async () => {
        const [a, b] = ctx.memberIds;
        await ctx.repo().record(prickle(0, "2097-02-10T10:00:00Z", ctx.unique("prkl")));
        await ctx.repo().record(prickle(0, "2097-01-10T10:00:00Z", ctx.unique("prkl")));
        await ctx.repo().record(post(0, "2097-03-10T10:00:00Z", "slack_thread_reply"));
        await ctx.repo().record(post(0, "2097-02-20T10:00:00Z"));
        await ctx.repo().record(post(0, "2097-01-01T10:00:00Z", "slack_reaction")); // not a post

        const first = await ctx.repo().firsts(a);
        expect([first.firstPrickleAt && new Date(first.firstPrickleAt).toISOString(), first.firstSlackPostAt && new Date(first.firstSlackPostAt).toISOString()]).toEqual([
          "2097-01-10T10:00:00.000Z",
          "2097-02-20T10:00:00.000Z",
        ]);
        expect(await ctx.repo().firsts(b)).toEqual({ firstPrickleAt: null, firstSlackPostAt: null });
      });
    });
  });
}

import { describe, it, expect, beforeEach } from "vitest";
import type { NewZoomAttendee, ZoomRepository } from "@/lib/data/zoom";

export type ZoomContractContext = {
  repo: () => ZoomRepository;
  /** A value no other run has used (names, meeting uuids, ids). Everything a test stores carries it, so `clear` can find it. */
  unique: (label: string) => string;
  /** Removes every attendee, meeting and ignored name this context made. */
  clear: () => Promise<void>;
};

const at = (day: number, hour = 9, minute = 0) => new Date(Date.UTC(2097, 6, day, hour, minute)).toISOString();
const ms = (iso: string) => new Date(iso).getTime();

/** Behavior every `ZoomRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineZoomContract(name: string, setup: () => ZoomContractContext) {
  describe(`${name} (ZoomRepository contract)`, () => {
    let ctx: ZoomContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    /** A stay of 30 minutes (unless said otherwise) by `who` in the meeting `uuid`. */
    const stay = (who: string, uuid: string | null, day: number, hour = 9, extra: Partial<NewZoomAttendee> = {}): NewZoomAttendee => ({
      meeting_id: uuid ?? ctx.unique("mid"),
      meeting_uuid: uuid,
      name: who,
      join_time: at(day, hour),
      leave_time: at(day, hour, 30),
      duration: 30,
      ...extra,
    });
    const mine = <T extends { name: string }>(rows: T[], ...names: string[]) => rows.filter((r) => names.includes(r.name));

    it("adds attendee rows and updates the one with the same meeting, name and join time instead of duplicating it", async () => {
      const ada = ctx.unique("ada");
      const m1 = ctx.unique("m");
      await ctx.repo().upsertAttendees([stay(ada, m1, 3, 9, { email: "ada@example.test", topic: "Writing" })]);
      const before = await ctx.repo().attendeeCount();

      await ctx.repo().upsertAttendees([stay(ada, m1, 3, 9, { duration: 45, topic: "Writing, renamed" }), stay(ada, m1, 3, 10)]);

      expect(await ctx.repo().attendeeCount()).toBe(before + 1);
      const rows = mine(await ctx.repo().attendeesOverlapping(at(3, 0), at(4, 0)), ada);
      expect(rows.map((r) => [r.join_time, r.duration, r.topic])).toEqual([
        [expect.stringContaining("T09:00:00"), 45, "Writing, renamed"],
        [expect.stringContaining("T10:00:00"), 30, null],
      ]);
      await ctx.repo().upsertAttendees([]); // nothing to do
    });

    it("lists the stays that overlap a range, by join time, and the names and emails of them", async () => {
      const early = ctx.unique("early");
      const during = ctx.unique("during");
      const spanning = ctx.unique("spanning");
      const after = ctx.unique("after");
      const m = ctx.unique("m");
      await ctx.repo().upsertAttendees([
        stay(after, m, 5, 12),
        stay(during, m, 5, 9, { email: "during@example.test" }),
        stay(early, m, 5, 7), // 07:00-07:30, over before the range
        stay(spanning, m, 5, 8, { leave_time: at(5, 10) }), // 08:00-10:00, reaches into the range
      ]);
      const [from, to] = [at(5, 8, 45), at(5, 11)];

      const rows = mine(await ctx.repo().attendeesOverlapping(from, to), early, during, spanning, after);
      expect(rows.map((r) => r.name)).toEqual([spanning, during]);
      expect(rows[1]).toMatchObject({ email: "during@example.test", meeting_uuid: m, duration: 30 });

      const names = mine(await ctx.repo().attendeeNamesOverlapping(from, to), early, during, spanning, after);
      expect(names).toHaveLength(2);
      expect(names).toEqual(expect.arrayContaining([{ name: during, email: "during@example.test" }, { name: spanning, email: null }]));
      // A stay that only ends at the range's start, or starts at its end, doesn't overlap it.
      expect(mine(await ctx.repo().attendeeNamesOverlapping(at(5, 9, 30), at(5, 12)), during, after)).toEqual([]);
    });

    it("reads past a thousand rows, in every list", async () => {
      const who = ctx.unique("bulk");
      const m = ctx.unique("m");
      const rows = Array.from({ length: 1050 }, (_, i) =>
        stay(who, m, 6, 0, { join_time: new Date(Date.UTC(2097, 6, 6, 0, 0, i)).toISOString(), leave_time: at(6, 23), duration: i + 1 })
      );
      await ctx.repo().upsertAttendees(rows);

      expect(mine(await ctx.repo().attendeesOverlapping(at(6, 1), at(7, 0)), who)).toHaveLength(1050);
      expect(mine(await ctx.repo().attendeeNamesOverlapping(at(6, 1), at(7, 0)), who)).toHaveLength(1050);
      expect(mine(await ctx.repo().attendeesForMatching(), who)).toHaveLength(1050);
      expect(mine(await ctx.repo().attendeesSince(at(6, 0)), who)).toHaveLength(1050);
      expect(mine(await ctx.repo().appearancesOf([who]), who)).toHaveLength(1050);
      expect((await ctx.repo().meetingCountsByName([who])).get(who)).toBe(1);
      expect(await ctx.repo().meetingUuidsForName(who)).toEqual([m]);
    });

    it("lists the columns name matching reads, leaving out rows with no meeting when asked", async () => {
      const withMeeting = ctx.unique("with");
      const without = ctx.unique("without");
      const m = ctx.unique("m");
      await ctx.repo().upsertAttendees([stay(withMeeting, m, 8, 9, { email: "with@example.test" }), stay(without, null, 8, 9)]);

      const all = mine(await ctx.repo().attendeesForMatching(), withMeeting, without);
      expect(all).toHaveLength(2);
      expect(all.find((r) => r.name === withMeeting)).toEqual({ name: withMeeting, email: "with@example.test", meeting_uuid: m, join_time: expect.any(String), leave_time: expect.any(String) });
      expect(ms(all[0].join_time)).toBe(ms(at(8, 9)));
      expect(mine(await ctx.repo().attendeesForMatching({ withMeetingOnly: true }), withMeeting, without).map((r) => r.name)).toEqual([withMeeting]);
    });

    it("lists the attendees since an instant", async () => {
      const old = ctx.unique("old");
      const recent = ctx.unique("recent");
      const m = ctx.unique("m");
      await ctx.repo().upsertAttendees([stay(old, m, 9, 8), stay(recent, m, 9, 12, { email: "recent@example.test" })]);

      expect(mine(await ctx.repo().attendeesSince(at(9, 12)), old, recent)).toEqual([{ name: recent, email: "recent@example.test", meeting_uuid: m }]);
    });

    it("lists every appearance of some names, and counts the distinct meetings each is in", async () => {
      const ada = ctx.unique("ada");
      const bea = ctx.unique("bea");
      const cy = ctx.unique("cy");
      const [m1, m2] = [ctx.unique("m1"), ctx.unique("m2")];
      await ctx.repo().upsertAttendees([
        stay(ada, m1, 10, 9, { topic: "Morning" }),
        stay(ada, m1, 10, 10), // rejoined the same meeting
        stay(ada, m2, 11, 9),
        stay(ada, null, 12, 9), // no meeting uuid: an appearance, but not a meeting
        stay(bea, m1, 10, 9, { email: "bea@example.test" }),
        stay(cy, m2, 11, 9),
      ]);

      const seen = mine(await ctx.repo().appearancesOf([ada, bea, bea]), ada, bea);
      expect(seen).toHaveLength(5);
      expect(seen.find((r) => r.name === bea)).toMatchObject({ email: "bea@example.test", meeting_uuid: m1, topic: null });
      expect(seen.find((r) => r.topic === "Morning")).toMatchObject({ name: ada, meeting_uuid: m1 });
      expect(await ctx.repo().appearancesOf([])).toEqual([]);

      const counts = await ctx.repo().meetingCountsByName([ada, bea, ctx.unique("never")]);
      expect(counts.get(ada)).toBe(2);
      expect(counts.get(bea)).toBe(1);
      expect(counts.size).toBe(2);
      expect((await ctx.repo().meetingCountsByName([])).size).toBe(0);

      expect((await ctx.repo().meetingUuidsForName(ada)).sort()).toEqual([m1, m2].sort());
      expect(await ctx.repo().meetingUuidsForName(ctx.unique("never"))).toEqual([]);
    });

    it("lists who was in a session, by meeting uuid or by meeting id when there is no uuid, each row once", async () => {
      const [ada, bea, cy, dee] = [ctx.unique("ada"), ctx.unique("bea"), ctx.unique("cy"), ctx.unique("dee")];
      const [m1, m2, legacyId] = [ctx.unique("m1"), ctx.unique("m2"), ctx.unique("legacy")];
      await ctx.repo().upsertAttendees([
        stay(ada, m1, 13, 9, { meeting_id: m2 }), // found by uuid and by meeting id, listed once, under its uuid
        stay(bea, m1, 13, 9, { email: "bea@example.test" }),
        stay(cy, null, 13, 9, { meeting_id: legacyId }),
        stay(dee, m2, 13, 9),
      ]);

      const sessions = await ctx.repo().attendeesInSessions([m1, m2, legacyId, ctx.unique("empty")]);

      expect([...sessions.keys()].sort()).toEqual([m1, m2, legacyId].sort());
      expect(sessions.get(m2)).toEqual([{ name: dee, email: null }]);
      expect(sessions.get(m1)!.map((a) => a.name).sort()).toEqual([ada, bea].sort());
      expect(sessions.get(m1)!.find((a) => a.name === bea)).toEqual({ name: bea, email: "bea@example.test" });
      expect(sessions.get(legacyId)).toEqual([{ name: cy, email: null }]);
      expect((await ctx.repo().attendeesInSessions([])).size).toBe(0);
    });

    it("keeps meetings, finds the latest start, and replaces a meeting with the same uuid", async () => {
      const uuid = ctx.unique("meeting");
      const start = at(20, 15);
      await ctx.repo().upsertMeeting({ meeting_uuid: uuid, meeting_id: "123", topic: "Writing", start_time: start, data: { host_id: "host-a" } });
      expect(ms((await ctx.repo().latestMeetingStart())!)).toBeGreaterThanOrEqual(ms(start));

      await ctx.repo().upsertMeeting({ meeting_uuid: uuid, meeting_id: "123", topic: "Writing, renamed", start_time: at(21, 15), data: { host_id: "host-b" } });

      expect(ms((await ctx.repo().latestMeetingStart())!)).toBeGreaterThanOrEqual(ms(at(21, 15)));
      // Replaced, not duplicated: host-a is gone and host-b is the only host this meeting has.
      const hosts = await ctx.repo().importedHostIds(at(20, 0));
      expect(hosts.has("host-b")).toBe(true);
      expect(hosts.has("host-a")).toBe(false);
    });

    it("lists the Zoom hosts of the meetings since an instant, leaving out meetings without one", async () => {
      const [old, recent, hostless] = [ctx.unique("old"), ctx.unique("recent"), ctx.unique("hostless")];
      const [oldHost, recentHost] = [ctx.unique("host-old"), ctx.unique("host-recent")];
      await ctx.repo().upsertMeeting({ meeting_uuid: old, meeting_id: "1", topic: "T", start_time: at(22, 8), data: { host_id: oldHost } });
      await ctx.repo().upsertMeeting({ meeting_uuid: recent, meeting_id: "2", topic: "T", start_time: at(22, 12), data: { host_id: recentHost } });
      await ctx.repo().upsertMeeting({ meeting_uuid: hostless, meeting_id: "3", topic: "T", start_time: at(22, 13), data: { other: 1 } });

      const hosts = await ctx.repo().importedHostIds(at(22, 10));

      expect(hosts.has(recentHost)).toBe(true);
      expect(hosts.has(oldHost)).toBe(false);
      expect([...hosts].every((h) => typeof h === "string" && h.length > 0)).toBe(true);
    });

    it("ignores a name everywhere, lists it, refuses it twice, and stops ignoring it", async () => {
      const zoomName = ctx.unique("ignored");
      const other = ctx.unique("ignored-other");

      await ctx.repo().ignoreName({ zoomName, reason: "a test account", ignoredBy: null });
      await ctx.repo().ignoreName({ zoomName: other, reason: null, ignoredBy: null });

      const listed = await ctx.repo().ignoredNames();
      expect(listed).toEqual(expect.arrayContaining([zoomName, other]));
      await expect(ctx.repo().ignoreName({ zoomName, reason: null, ignoredBy: null })).rejects.toThrow();

      await ctx.repo().unignoreName(zoomName);
      const after = await ctx.repo().ignoredNames();
      expect(after).not.toContain(zoomName);
      expect(after).toContain(other);
      await ctx.repo().unignoreName(ctx.unique("never")); // nothing to remove
    });
  });
}

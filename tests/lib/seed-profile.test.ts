import { describe, expect, it } from "vitest";
import { createInMemoryRepos } from "@/lib/data/repos";
import { buildDataset, hash01, hostNamed, seedId, typeNamed, type SeedProfile } from "@/lib/data/seed-profile";
import { COMMUNITY } from "@/lib/data/profiles/community";

const ZONE = "America/New_York";
const NOW = new Date("2026-10-24T20:00:00Z"); // a Saturday afternoon in New York
const build = (now = NOW, profile: SeedProfile = COMMUNITY) => buildDataset(profile, now, { timeZone: ZONE });

const localHour = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", hour12: false }).format(new Date(iso)));
const localWeekday = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short" }).format(new Date(iso));

describe("titles", () => {
  it("reads the type and the host from a calendar title", () => {
    expect(typeNamed("Progress Prickle w/Hazel Hosting")).toBe("Progress Prickle");
    expect(hostNamed("Progress Prickle w/Hazel Hosting")).toBe("Hazel Hosting");
    expect(typeNamed("Heads Down Prickle")).toBe("Heads Down Prickle");
    expect(hostNamed("Heads Down Prickle")).toBeNull();
  });
});

describe("ids and hashing", () => {
  it("makes stable prefixed ids from text, and a stable number from text", () => {
    expect(seedId("mbr", "ada@example.com")).toBe(seedId("mbr", "ada@example.com"));
    expect(seedId("mbr", "ada@example.com")).toMatch(/^mbr_[1-9A-HJ-NP-Za-km-z]{12}$/);
    expect(seedId("mbr", "a")).not.toBe(seedId("mbr", "b"));
    expect(hash01("x")).toBe(hash01("x"));
    expect(hash01("x")).toBeGreaterThanOrEqual(0);
    expect(hash01("x")).toBeLessThan(1);
  });
});

describe("buildDataset", () => {
  it("is deterministic: the same profile and moment make the same community", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("holds together: everything points at something that exists", () => {
    const d = build();
    const members = new Set(d.members.map((m) => m.id));
    const types = new Set(d.prickleTypes.map((t) => t.id));
    const prickles = new Set(d.prickles.map((p) => p.id));
    const badgeTypes = new Set(d.badgeTypes.map((b) => b.id));

    expect(d.prickles.every((p) => p.typeId && types.has(p.typeId))).toBe(true);
    expect(d.prickles.filter((p) => p.hostId).every((p) => members.has(p.hostId as string))).toBe(true);
    expect(d.attendance.every((a) => members.has(a.memberId) && prickles.has(a.prickleId))).toBe(true);
    expect(d.memberBadges.every((b) => members.has(b.memberId) && badgeTypes.has(b.badgeTypeId))).toBe(true);
    expect(d.inAppNotifications.every((n) => members.has(n.memberId))).toBe(true);
    expect(new Set(d.members.map((m) => m.id)).size).toBe(d.members.length); // ids are distinct
    expect(new Set(d.prickles.map((p) => p.id)).size).toBe(d.prickles.length);
  });

  it("makes members of everyone who has a record, staff included, and none for staff without one", () => {
    const d = build();

    expect(d.members.map((m) => m.name)).toContain("Maya Example");
    // Staff are members too (they sign up for the newsletter, and the member pages need a record).
    expect(d.members.map((m) => m.name)).toContain("Amelia Admin");
    expect(d.members).toHaveLength(COMMUNITY.people.filter((p) => p.joinedDaysAgo !== null).length);
    expect(d.members.find((m) => m.name === "Hazel Hosting")?.bio).toMatch(/early Progress Prickles/);

    const withoutRecord: SeedProfile = { ...COMMUNITY, people: COMMUNITY.people.map((p) => (p.key === "admin" ? { ...p, joinedDaysAgo: null } : p)) };
    expect(build(NOW, withoutRecord).members.map((m) => m.name)).not.toContain("Amelia Admin");
  });

  it("lays the weekly rhythm over the window: this pattern has a slot every weekday, so one prickle for each day from four weeks back to two ahead", () => {
    const d = build();
    const days = COMMUNITY.history.daysBack + COMMUNITY.history.daysAhead + 1;

    expect(COMMUNITY.weeklyPattern.map((s) => s.weekday).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(d.prickles).toHaveLength(days);
  });

  it("puts each slot on its weekday and hour in the organization's zone, through the daylight saving change", () => {
    // The fall-back change was Sunday 2026-11-01: a window across it must keep 09:00 at 09:00.
    const d = build(new Date("2026-11-04T17:00:00Z"));
    const mondays = d.prickles.filter((p) => localWeekday(p.startTime) === "Mon");

    expect(mondays.length).toBeGreaterThanOrEqual(5);
    expect(mondays.every((p) => localHour(p.startTime) === 9)).toBe(true);
    const sundays = d.prickles.filter((p) => localWeekday(p.startTime) === "Sun");
    expect(sundays.every((p) => localHour(p.startTime) === 19)).toBe(true);
    const hazel = d.members.find((m) => m.name === "Hazel Hosting")!.id;
    expect(mondays.every((p) => p.hostId === hazel)).toBe(true);
    expect(d.prickles.find((p) => localWeekday(p.startTime) === "Sat")?.hostId).toBeNull(); // Heads Down has no host
  });

  it("records attendance only for prickles that have ended, and never before someone joined", () => {
    const d = build();
    const byId = new Map(d.prickles.map((p) => [p.id, p]));
    const joined = new Map(COMMUNITY.people.filter((p) => p.joinedDaysAgo !== null).map((p) => [d.members.find((m) => m.email === p.email)!.id, NOW.getTime() - (p.joinedDaysAgo as number) * 86_400_000]));

    expect(d.attendance.length).toBeGreaterThan(100);
    expect(d.attendance.every((a) => Date.parse(byId.get(a.prickleId)!.endTime) <= NOW.getTime())).toBe(true);
    for (const a of d.attendance) {
      const prickle = byId.get(a.prickleId)!;
      if (prickle.hostId === a.memberId) continue; // hosts come early
      expect(joined.get(a.memberId)!).toBeLessThanOrEqual(Date.parse(prickle.startTime));
    }
  });

  it("has every host at their own ended prickles, early and staying to the end", () => {
    const d = build();
    const ended = d.prickles.filter((p) => p.hostId && Date.parse(p.endTime) <= NOW.getTime());

    expect(ended.length).toBeGreaterThan(10);
    for (const p of ended) {
      const hostRows = d.attendance.filter((a) => a.prickleId === p.id && a.memberId === p.hostId);
      expect(hostRows).toHaveLength(1);
      expect(Date.parse(hostRows[0].joinTime)).toBeLessThan(Date.parse(p.startTime));
      expect(Date.parse(hostRows[0].leaveTime)).toBeGreaterThan(Date.parse(p.endTime));
    }
  });

  it("makes the same crowd regardless of how many times it is built, and a different one for a different moment", () => {
    const a = build().attendance.map((r) => r.id).join();
    const b = build().attendance.map((r) => r.id).join();
    const later = build(new Date(NOW.getTime() + 7 * 86_400_000)).attendance.map((r) => r.id).join();

    expect(a).toBe(b);
    expect(later).not.toBe(a);
  });

  it("rejects a badge or notification for someone who isn't in the profile", () => {
    const broken: SeedProfile = { ...COMMUNITY, badges: [{ key: "x", name: "X", icon: "x", category: "special", awardedTo: [{ person: "nobody", daysAgo: 1 }] }] };

    expect(() => build(NOW, broken)).toThrow(/no person "nobody"/);
  });
});

describe("the profile through the repositories", () => {
  const repos = createInMemoryRepos(build());
  const maya = () => repos.members.byEmail("maya.example@example.com");

  it("is a community the member repository can list and search", async () => {
    expect(await repos.members.count()).toBe(15);
    expect((await repos.members.search({ words: ["hazel"] })).map((m) => m.name)).toEqual(["Hazel Hosting"]);
    expect((await repos.members.profile((await maya())!.id))?.bio).toMatch(/lighthouse bakery/);
  });

  it("has prickles with their type and host, and who came", async () => {
    const hazel = (await repos.members.byEmail("hazel.hosting@example.com"))!;
    const types = await repos.prickles.types();
    const hosted = await repos.prickles.startingBetween({ from: "2000-01-01", hostId: hazel.id });

    expect(types.map((t) => t.name).sort()).toEqual(["Heads Down Prickle", "Plot or Plan Prickle", "Progress Prickle", "Sprint Prickle"]);
    expect(hosted.length).toBeGreaterThan(8);
    expect(hosted[0].host?.name).toBe("Hazel Hosting");
    expect(await repos.attendance.countForMember(hazel.id)).toBeGreaterThan(8);
  });

  it("gives the demo member a bell with something unread, and badges", async () => {
    const m = (await maya())!;
    const hazel = (await repos.members.byEmail("hazel.hosting@example.com"))!;

    expect(await repos.notifications.inAppCount(m.id, { unreadOnly: true })).toBe(1);
    expect((await repos.notifications.inAppLatest(m.id, 10)).map((n) => n.kind)).toEqual(["prickle_checkin", "prickle_checkout"]);
    expect((await repos.badges.awardsOf(hazel.id)).length).toBe(2);
    expect((await repos.badges.awardCounts()).size).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { createInMemoryRepos } from "@/lib/data/repos";
import { buildDataset, type SeedProfile } from "@/lib/data/seed-profile";
import { FIRST_WEEK, HOSTING_HEAVY, isProfileName, LAPSING, PROFILE_NAMES, PROFILES } from "@/lib/data/profiles/index";

const ZONE = "America/New_York";
const NOW = new Date("2026-10-24T20:00:00Z"); // a Saturday afternoon in New York
const build = (now: Date, profile: SeedProfile) => buildDataset(profile, now, { timeZone: ZONE });
const DAY = 86_400_000;
const PREFIXED = (prefix: string) => new RegExp(`^${prefix}_[1-9A-HJ-NP-Za-km-z]{12}$`);

const localHour = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", hour12: false }).format(new Date(iso)));
const localWeekday = (iso: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short" }).format(new Date(iso)));

describe("every registered profile", () => {
  const NOWS = [
    NOW,
    new Date("2026-11-01T05:30:00Z"), // the fall-back Sunday, 01:30 in New York
    new Date("2026-03-08T16:00:00Z"), // the spring-forward Sunday
    new Date("2026-11-04T04:30:00Z"), // 23:30 Tuesday in New York, already Wednesday in UTC
  ];

  it("registers each profile under its own name", () => {
    expect([...PROFILE_NAMES].sort()).toEqual(["community", "first-week", "hosting-heavy", "lapsing"]);
    for (const name of PROFILE_NAMES) expect(PROFILES[name].name).toBe(name);
    expect(isProfileName("lapsing")).toBe(true);
    expect(isProfileName("toString")).toBe(false);
  });

  for (const name of PROFILE_NAMES) {
    for (const now of NOWS) {
      it(`${name} at ${now.toISOString()}: prefixed unique ids, attendance only for ended prickles, fake addresses`, () => {
        const d = build(now, PROFILES[name]);
        const prickles = new Map(d.prickles.map((p) => [p.id, p]));
        const unique = (ids: string[]) => expect(new Set(ids).size).toBe(ids.length);

        expect(d.members.every((m) => PREFIXED("mbr").test(m.id))).toBe(true);
        expect(d.prickles.every((p) => PREFIXED("prkl").test(p.id))).toBe(true);
        expect(d.attendance.every((a) => PREFIXED("att").test(a.id))).toBe(true);
        unique(d.members.map((m) => m.id));
        unique(d.prickles.map((p) => p.id));
        unique(d.attendance.map((a) => a.id));
        unique(d.mentorships.map((m) => m.id));
        expect(d.members.every((m) => m.email?.endsWith("@example.com"))).toBe(true);
        expect(d.attendance.length).toBeGreaterThan(0);
        for (const a of d.attendance) {
          expect(prickles.has(a.prickleId)).toBe(true);
          expect(Date.parse(prickles.get(a.prickleId)!.endTime)).toBeLessThanOrEqual(now.getTime());
          expect(Date.parse(a.joinTime)).toBeLessThan(Date.parse(a.leaveTime));
        }
      });
    }

    it(`${name}: every slot keeps its local weekday and hour across the daylight saving change`, () => {
      const profile = PROFILES[name];
      const d = build(new Date("2026-11-04T17:00:00Z"), profile);
      const hours = new Map(profile.weeklyPattern.map((s) => [s.weekday, Number(s.startLocal.slice(0, 2))]));

      expect(d.prickles.length).toBeGreaterThan(0);
      for (const p of d.prickles) expect(localHour(p.startTime)).toBe(hours.get(localWeekday(p.startTime)));
    });
  }
});

describe("first-week: a new member with a big sister", () => {
  const d = build(NOW, FIRST_WEEK);
  const idOf = (email: string) => d.members.find((m) => m.email === email)!.id;

  it("matches the newcomer with their big sister for a 30-day trial that began the day they joined", () => {
    expect(d.mentorships).toHaveLength(1);
    const [match] = d.mentorships;
    expect(match.new_member_id).toBe(idOf("nora.newcomer@example.com"));
    expect(match.mentor_member_id).toBe(idOf("bea.buddy@example.com"));
    expect(match.status).toBe("matched");
    expect(match.started_on).toBe("2026-10-20");
    expect(match.trial_ends_on).toBe("2026-11-19");
  });

  it("reads through the mentorship repository from both sides", async () => {
    const repos = createInMemoryRepos(d);
    const mine = await repos.mentorship.myMentorships(idOf("nora.newcomer@example.com"));

    expect(mine).toHaveLength(1);
    expect(mine[0].viewer_role).toBe("new_member");
    expect(await repos.mentorship.myMentorships(idOf("bea.buddy@example.com"))).toHaveLength(1);
  });

  it("has attendance only since they joined, and staff without a record are not members", () => {
    const nora = idOf("nora.newcomer@example.com");
    const joined = NOW.getTime() - 4 * DAY;
    const prickles = new Map(d.prickles.map((p) => [p.id, p]));
    const theirs = d.attendance.filter((a) => a.memberId === nora);

    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((a) => Date.parse(prickles.get(a.prickleId)!.startTime) >= joined)).toBe(true);
    expect(d.members.map((m) => m.name)).not.toContain("Ada Admin");
  });
});

describe("lapsing: a regular who stopped coming", () => {
  const d = build(NOW, LAPSING);
  const prickles = new Map(d.prickles.map((p) => [p.id, p]));
  const lastSeen = (name: string) => {
    const id = d.members.find((m) => m.name === name)!.id;
    return Math.max(...d.attendance.filter((a) => a.memberId === id).map((a) => Date.parse(prickles.get(a.prickleId)!.startTime)));
  };

  it("has no attendance in the last 24 days though her rate is high, and plenty before", () => {
    const id = d.members.find((m) => m.name === "Lena Lapsing")!.id;

    expect(d.attendance.filter((a) => a.memberId === id).length).toBeGreaterThan(5);
    expect(lastSeen("Lena Lapsing")).toBeLessThanOrEqual(NOW.getTime() - 24 * DAY);
  });

  it("keeps the room busy for everyone else, and carries a cancelled member's status", () => {
    expect(lastSeen("Hana Example")).toBeGreaterThan(NOW.getTime() - 7 * DAY);
    expect(d.members.find((m) => m.name === "Greta Goneby")?.status).toBe("cancelled");
    expect(d.members.find((m) => m.name === "Lena Lapsing")?.status).toBe("active");
  });
});

describe("hosting-heavy: one host runs most of the week", () => {
  it("gives the main host five of the seven slots, and the badge for it", async () => {
    const d = build(NOW, HOSTING_HEAVY);
    const hana = d.members.find((m) => m.name === "Hana Hostess")!;
    const hosted = d.prickles.filter((p) => p.hostId === hana.id).length;

    expect(hosted / d.prickles.length).toBeGreaterThan(0.6);
    expect((await createInMemoryRepos(d).badges.awardsOf(hana.id)).length).toBe(1);
  });
});

describe("profile defaults", () => {
  it("builds from only the required fields: an active member, no badges, notifications or matches", () => {
    const bare: SeedProfile = {
      name: "bare",
      history: { daysBack: 14, daysAhead: 0 },
      people: [{ key: "a", name: "Ada Example", email: "ada@example.com", joinedDaysAgo: 100 }],
      weeklyPattern: [{ weekday: 1, startLocal: "09:00", minutes: 60, summary: "Heads Down Prickle" }],
    };
    const d = build(NOW, bare);

    expect(d.members).toHaveLength(1);
    expect(d.members[0].status).toBe("active");
    expect(d.memberBadges).toHaveLength(0);
    expect(d.inAppNotifications).toHaveLength(0);
    expect(d.mentorships).toHaveLength(0);
  });
});

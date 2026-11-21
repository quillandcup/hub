import { describe, expect, it } from "vitest";
import { getBadgeRecipients, getMemberBadges, type BadgeLevel, type BadgeType } from "@/lib/badges";
import { milestoneBadgeCounts, reachedWhileMember } from "@/lib/finishers";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { SupabaseMilestoneRepository } from "@/lib/data/milestones";
import type { Db } from "@/lib/data/db";
import type { Row } from "@/lib/data/db";
import type { Visibility } from "@/lib/writing-visibility";

const finisherType: BadgeType = { id: "bdgt_finisher", key: "finisher", name: "Finisher", description: null, icon: "x", category: "community", has_levels: true, counted: true, is_automatic: true, program_id: null };
const authorType: BadgeType = { ...finisherType, id: "bdgt_author", key: "author", name: "Author" };
const levelsFor = (type: BadgeType, label: string): BadgeLevel[] =>
  [1, 3, 5, 10].map((threshold, i) => ({ id: `${type.id}_${i}`, badge_type_id: type.id, level: i + 1, name: i === 0 ? label : `${threshold}x ${label}`, threshold }));
const allLevels = [...levelsFor(finisherType, "Finisher"), ...levelsFor(authorType, "Author")];

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", firstJoinedAt: "2024-01-05" };
const BO = { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test", firstJoinedAt: "2024-01-05" };

let seq = 0;
function milestone(over: Partial<Row<"member_milestones">> & { member_id: string }): Row<"member_milestones"> {
  seq += 1;
  return {
    id: `mlst_${String(seq).padStart(12, "0")}`,
    kind: "the_end",
    project_id: null,
    book_id: null,
    title: `Fake Work ${seq}`,
    achieved_on: null,
    story_before: null,
    story_after: null,
    source: "member",
    status: "confirmed",
    consent_profile: false,
    consent_homepage: false,
    consent_testimonial: false,
    visibility: "community",
    created_by: null,
    confirmed_at: "2026-11-01T00:00:00Z",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    deleted_at: null,
    ...over,
  } as Row<"member_milestones">;
}

function reposWith(rows: Row<"member_milestones">[], members = [ADA, BO]) {
  return createInMemoryRepos(new InMemoryDataset({ members, badgeTypes: [finisherType, authorType], badgeLevels: allLevels, memberMilestones: rows }));
}

const titles = async (repos: ReturnType<typeof reposWith>, memberId: string, viewer: "self" | "others", joined: string | null = ADA.firstJoinedAt) =>
  (await getMemberBadges(repos, memberId, 0, joined, viewer)).map((b) => b.levelName).sort();

const many = (n: number, over: Partial<Row<"member_milestones">> & { member_id: string }) => Array.from({ length: n }, () => milestone(over));

describe("reachedWhileMember", () => {
  it("counts an undated milestone", () => expect(reachedWhileMember(null, "2024-01-05")).toBe(true));
  it("counts a dated one on or after the join date, not before", () => {
    expect(reachedWhileMember("2024-01-05", "2024-01-05")).toBe(true);
    expect(reachedWhileMember("2024-01-06", "2024-01-05")).toBe(true);
    expect(reachedWhileMember("2024-01-04", "2024-01-05")).toBe(false);
  });
  it("has nothing to compare with when the member has no join date, so a dated one counts", () => expect(reachedWhileMember("2001-01-01", null)).toBe(true));
  it("reads a timestamp join date by its day", () => expect(reachedWhileMember("2024-01-05", "2024-01-05T00:00:00Z")).toBe(true));
});

describe("milestoneBadgeCounts", () => {
  it("counts each kind apart, ignoring one reached before joining and an unknown kind", () => {
    const counts = milestoneBadgeCounts(
      [
        { kind: "the_end", achievedOn: null },
        { kind: "the_end", achievedOn: "2023-12-31" },
        { kind: "publish_ready", achievedOn: "2025-01-01" },
        { kind: "published", achievedOn: null },
      ],
      "2024-01-05",
    );
    expect(counts).toEqual({ the_end: 1, publish_ready: 1 });
  });
});

describe("Finisher and Author badges", () => {
  it("shows the real count of the Finisher badge (1, 2, 7 ... no steps), and Author apart from it", async () => {
    const expected: [number, string | undefined][] = [[0, undefined], [1, "Finisher"], [2, "2x Finisher"], [3, "3x Finisher"], [4, "4x Finisher"], [7, "7x Finisher"], [10, "10x Finisher"], [14, "14x Finisher"]];
    for (const [count, name] of expected) {
      const repos = reposWith(many(count, { member_id: ADA.id, kind: "the_end" }));
      expect(await titles(repos, ADA.id, "self")).toEqual(name ? [name] : []);
    }
    const repos = reposWith([...many(3, { member_id: ADA.id, kind: "publish_ready" }), ...many(1, { member_id: ADA.id, kind: "the_end" })]);
    expect(await titles(repos, ADA.id, "self")).toEqual(["3x Author", "Finisher"]);
  });

  it("falls back to the levels for a type that is not counted", async () => {
    const leveled = { ...finisherType, counted: false };
    const repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA], badgeTypes: [leveled], badgeLevels: levelsFor(leveled, "Finisher"), memberMilestones: many(4, { member_id: ADA.id }) }));
    expect((await getMemberBadges(repos, ADA.id, 0, ADA.firstJoinedAt, "self")).map((b) => b.levelName)).toEqual(["3x Finisher"]);
  });

  it("counts a private milestone for its member but not for anyone else", async () => {
    const rows = [milestone({ member_id: ADA.id, visibility: "private" }), milestone({ member_id: ADA.id, visibility: "community" }), milestone({ member_id: ADA.id, visibility: "public" })];
    const repos = reposWith(rows);
    expect(await titles(repos, ADA.id, "self")).toEqual(["3x Finisher"]);
    expect(await titles(repos, ADA.id, "others")).toEqual(["2x Finisher"]);
    // Others is the default, so a caller that forgets to say who is looking never shows the private one.
    expect((await getMemberBadges(repos, ADA.id, 0, ADA.firstJoinedAt)).map((b) => b.occurrences)).toEqual([2]);
  });

  it("counts community and public alike for a signed-in member", async () => {
    const vis: Visibility[] = ["community", "public"];
    const repos = reposWith(vis.map((visibility) => milestone({ member_id: ADA.id, visibility })));
    expect((await getMemberBadges(repos, ADA.id, 0, ADA.firstJoinedAt, "others")).map((b) => b.occurrences)).toEqual([2]);
  });

  it("ignores proposed, declined and taken-back milestones, even for the member", async () => {
    const repos = reposWith([
      milestone({ member_id: ADA.id, status: "proposed", visibility: "private", confirmed_at: null }),
      milestone({ member_id: ADA.id, status: "declined", visibility: "private", confirmed_at: null }),
      milestone({ member_id: ADA.id, deleted_at: "2026-11-02T00:00:00Z" }),
    ]);
    expect(await titles(repos, ADA.id, "self")).toEqual([]);
    expect(await titles(repos, ADA.id, "others")).toEqual([]);
  });

  it("counts only milestones reached while a member: undated yes, dated before the join date no, on it yes", async () => {
    const repos = reposWith([
      milestone({ member_id: ADA.id, achieved_on: null }),
      milestone({ member_id: ADA.id, achieved_on: "2024-01-04" }),
      milestone({ member_id: ADA.id, achieved_on: "2024-01-05" }),
      milestone({ member_id: ADA.id, achieved_on: "2026-02-01" }),
    ]);
    expect((await getMemberBadges(repos, ADA.id, 0, ADA.firstJoinedAt, "self")).map((b) => b.occurrences)).toEqual([3]);
    expect((await getMemberBadges(repos, ADA.id, 0, ADA.firstJoinedAt, "others")).map((b) => b.occurrences)).toEqual([3]);
  });

  it("lists, in bulk, each member's level as other members would see it, past 1,000 members", async () => {
    const members = Array.from({ length: 1_500 }, (_, i) => ({ id: `mbr_BULK${String(i).padStart(7, "0")}`, name: `Member ${String(i).padStart(4, "0")}`, email: `m${i}@example.test`, firstJoinedAt: "2024-01-05" }));
    const rows = [
      ...members.map((m) => milestone({ member_id: m.id })),
      ...members.slice(0, 3).map((m) => milestone({ member_id: m.id })),
      ...members.slice(0, 3).map((m) => milestone({ member_id: m.id, visibility: "private" })),
      ...members.slice(0, 2).map((m) => milestone({ member_id: m.id, achieved_on: "2020-01-01" })),
      ...members.map((m) => milestone({ member_id: m.id, kind: "publish_ready", status: "proposed", visibility: "private", confirmed_at: null })),
    ];
    const repos = reposWith(rows, members);
    const finishers = await getBadgeRecipients(repos, finisherType, levelsFor(finisherType, "Finisher"));
    expect(finishers).toHaveLength(1_500);
    expect(finishers.find((r) => r.memberId === members[0].id)).toMatchObject({ levelName: "2x Finisher", level: 2, occurrences: 2 });
    expect(finishers.filter((r) => r.occurrences === 1)).toHaveLength(1_497);
    expect(await getBadgeRecipients(repos, authorType, levelsFor(authorType, "Author"))).toEqual([]);
  });
});

describe("SupabaseMilestoneRepository.allShownToMembers", () => {
  it("asks for the shown milestones a page at a time until a short page", async () => {
    const ranges: [number, number][] = [];
    const row = (i: number) => ({ member_id: `mbr_${i}`, kind: "the_end", achieved_on: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "in", "order"]) chain[name] = () => chain;
    chain.range = (from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: from === 0 ? Array.from({ length: 1000 }, (_, n) => row(n)) : [row(1000)], error: null });
    };
    const rows = await new SupabaseMilestoneRepository({ from: () => chain } as unknown as Db).allShownToMembers();
    expect(rows).toHaveLength(1001);
    expect(rows[1000]).toEqual({ memberId: "mbr_1000", kind: "the_end", achievedOn: null });
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });
});

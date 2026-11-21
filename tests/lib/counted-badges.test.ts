import { describe, expect, it } from "vitest";
import { automaticBadgeLevel, computeEarnedBadges, countedBadgeName, getBadgeRecipients, getMemberBadges, getPublishedBookCount, type BadgeLevel, type BadgeType } from "@/lib/badges";
import { publishedBookCount } from "@/lib/finishers";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const type = (key: string, name: string, over: Partial<BadgeType> = {}): BadgeType => ({
  id: `bdgt_${key}`,
  key,
  name,
  description: null,
  icon: "x",
  category: "community",
  has_levels: true,
  counted: true,
  is_automatic: true,
  program_id: null,
  ...over,
});
const published = type("published_author", "Published Author");
const finisher = type("finisher", "Finisher");
const author = type("author", "Author");
const hostess = type("hostess", "Hostess", { counted: false });
// The old steps are still in the table until the contract step; a counted badge must ignore them.
const levels = (t: BadgeType): BadgeLevel[] => [1, 3, 5, 10].map((threshold, i) => ({ id: `${t.id}_${i}`, badge_type_id: t.id, level: i + 1, name: i === 0 ? t.name : `${threshold}x ${t.name}`, threshold }));
const allTypes = [published, finisher, author, hostess];
const allLevels = allTypes.flatMap(levels);

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", firstJoinedAt: "2026-03-01T15:00:00Z" };
let n = 0;
const book = (memberId: string, publishedDate: string, deleted = false) => ({
  id: `book_${String(++n).padStart(12, "0")}`,
  member_id: memberId,
  title: "A Fake Book",
  published_date: publishedDate,
  cover_asset_id: null,
  ...(deleted ? { deleted_at: "2026-11-01T00:00:00Z" } : {}),
});
const reposWith = (books: ReturnType<typeof book>[], members: { id: string; name: string; email: string; firstJoinedAt: string | null }[] = [ADA]) =>
  createInMemoryRepos(new InMemoryDataset({ members, badgeTypes: allTypes, badgeLevels: allLevels, memberBooks: books }));
const published_ = async (repos: ReturnType<typeof reposWith>, joined: string | null) =>
  (await getMemberBadges(repos, ADA.id, 0, joined)).filter((b) => b.badgeType.key === "published_author").map((b) => b.levelName);

describe("counted badge labels", () => {
  it("says the name for one and the real count after that: 1, 2, 7, with no steps", () => {
    expect(countedBadgeName("Finisher", 1)).toBe("Finisher");
    expect(countedBadgeName("Finisher", 2)).toBe("2x Finisher");
    expect(countedBadgeName("Finisher", 4)).toBe("4x Finisher");
    expect(countedBadgeName("Published Author", 7)).toBe("7x Published Author");
    expect(countedBadgeName("Author", 12)).toBe("12x Author");
  });

  it("shows nothing for none, and the count itself as the level so lists sort by it", () => {
    expect(automaticBadgeLevel(finisher, levels(finisher), 0)).toBeNull();
    expect(automaticBadgeLevel(finisher, levels(finisher), 1)).toEqual({ levelName: "Finisher", level: 1 });
    expect(automaticBadgeLevel(finisher, levels(finisher), 7)).toEqual({ levelName: "7x Finisher", level: 7 });
  });

  it("leaves a badge that is not counted on its levels (the hosted-quarter badges keep their steps)", () => {
    expect(automaticBadgeLevel(hostess, levels(hostess), 4)).toEqual({ levelName: "3x Hostess", level: 2 });
    expect(automaticBadgeLevel(hostess, levels(hostess), 0)).toBeNull();
    // A type from before the column existed has no `counted` at all.
    const old: BadgeType = { ...hostess, counted: undefined };
    expect(automaticBadgeLevel(old, levels(hostess), 5)).toEqual({ levelName: "5x Hostess", level: 3 });
  });

  it("makes the earned list for all three counted badges from the real numbers, and the Big Sister-style leveled one from its steps", () => {
    const earned = computeEarnedBadges(allTypes, new Map(allTypes.map((t) => [t.id, levels(t)])), [], {
      totalPricklesAttended: 0,
      firstJoinedAt: null,
      hostedQuarterCount: 6,
      publishedBookCount: 7,
      programCompletions: new Map(),
      milestoneCounts: { the_end: 2, publish_ready: 1 },
    });
    expect(Object.fromEntries(earned.map((b) => [b.badgeType.key, b.levelName]))).toEqual({
      published_author: "7x Published Author",
      finisher: "2x Finisher",
      author: "Author",
      hostess: "5x Hostess",
    });
  });
});

describe("the date rule for books (publishedBookCount, via reachedWhileMember)", () => {
  it("counts a book published on the join day or later, an undated one, and every book when there is no join date; not one from before", () => {
    expect(publishedBookCount(["2026-02-28"], "2026-03-01T15:00:00Z")).toBe(0);
    expect(publishedBookCount(["2026-03-01"], "2026-03-01T15:00:00Z")).toBe(1);
    expect(publishedBookCount(["2026-03-02"], "2026-03-01T15:00:00Z")).toBe(1);
    expect(publishedBookCount([null], "2026-03-01T15:00:00Z")).toBe(1);
    expect(publishedBookCount(["1999-01-01", "2026-02-28"], null)).toBe(2);
    expect(publishedBookCount(["2026-02-28", "2026-03-01", "2026-05-01"], "2026-03-01")).toBe(2);
    expect(publishedBookCount([], "2026-03-01")).toBe(0);
  });

  it("shows the real count for one member: 1, 2 and 7 books, counting only the live ones published while a member", async () => {
    for (const [count, label] of [[1, "Published Author"], [2, "2x Published Author"], [7, "7x Published Author"]] as const) {
      const repos = reposWith(Array.from({ length: count }, () => book(ADA.id, "2026-03-01")));
      expect(await published_(repos, ADA.firstJoinedAt)).toEqual([label]);
    }
    const repos = reposWith([book(ADA.id, "2026-02-28"), book(ADA.id, "2026-03-01"), book(ADA.id, "2026-09-01"), book(ADA.id, "2026-09-02", true)]);
    expect(await getPublishedBookCount(repos, ADA.id, ADA.firstJoinedAt)).toBe(2);
    expect(await published_(repos, ADA.firstJoinedAt)).toEqual(["2x Published Author"]);
    // Every book from before: no badge at all (the books are still on the Bookshelf).
    expect(await published_(reposWith([book(ADA.id, "2025-01-01")]), ADA.firstJoinedAt)).toEqual([]);
    expect(await repos.books.liveDates(ADA.id)).toHaveLength(3);
    // No join date: every live book counts.
    expect(await published_(reposWith([book(ADA.id, "2001-01-01"), book(ADA.id, "2002-01-01")]), null)).toEqual(["2x Published Author"]);
  });

  it("is the same for every viewer: books are public on the Bookshelf, so the count has no private side", async () => {
    const repos = reposWith([book(ADA.id, "2026-03-01"), book(ADA.id, "2026-03-05")]);
    const as = async (viewer: "self" | "others") => (await getMemberBadges(repos, ADA.id, 0, ADA.firstJoinedAt, viewer)).map((b) => b.levelName);
    expect(await as("self")).toEqual(await as("others"));
    expect(await as("others")).toEqual(["2x Published Author"]);
  });

  it("counts every member against their own join date in the recipients list, past 1,000 members", async () => {
    const members = Array.from({ length: 1_200 }, (_, i) => ({ id: `mbr_BULK${String(i).padStart(7, "0")}`, name: `Member ${String(i).padStart(4, "0")}`, email: `m${i}@example.test`, firstJoinedAt: i % 2 === 0 ? "2026-03-01" : null }));
    // Everyone has a 2026-02-28 book (it counts only for the members with no join date) and a 2026-03-01 book (it counts for all).
    const books = members.flatMap((m) => [book(m.id, "2026-02-28"), book(m.id, "2026-03-01")]);
    // The first member also has a book that is no longer live, and a third that counts.
    books.push(book(members[0].id, "2026-06-01", true), book(members[0].id, "2026-06-01"));
    const repos = reposWith(books, members);
    const recipients = await getBadgeRecipients(repos, published, levels(published));
    expect(recipients).toHaveLength(1_200);
    const label = (i: number) => recipients.find((r) => r.memberId === members[i].id);
    expect(label(0)).toMatchObject({ levelName: "2x Published Author", level: 2, occurrences: 2 });
    expect(label(1)).toMatchObject({ levelName: "2x Published Author", occurrences: 2 });
    expect(label(2)).toMatchObject({ levelName: "Published Author", occurrences: 1 });
    expect(recipients.filter((r) => r.occurrences === 1)).toHaveLength(599);
    // Nobody is awarded anything: the list is computed, no award rows exist.
    expect(await repos.badges.awardsOf(members[0].id)).toEqual([]);
  });
});

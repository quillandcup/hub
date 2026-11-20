import { describe, expect, it, vi } from "vitest";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";
import { InMemoryBookRepository, type BookSeed } from "@/lib/data/books";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryWritingRepository } from "@/lib/data/writing";
import { easternDay, easternDayStart, friendlyFloor, isLiveStatKey, LIVE_STAT_KEYS, LIVE_STAT_OPTIONS, LIVE_STATS, loadLiveStats } from "@/lib/landing/live-stats";

// "Now" is Thursday 10:00 Eastern (EST). The trailing 30 Eastern days begin Oct 21 00:00 (EDT, 04:00Z); the trailing 7 begin Nov 13 00:00 (EST, 05:00Z).
const NOW = new Date("2026-11-19T15:00:00Z");

const typeRow = { id: "ptyp_1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, start: string, end: string) => ({ id, typeId: typeRow.id, hostId: null, title: null, startTime: start, endTime: end, source: "calendar", calendarEventId: null });
const stay = (id: string, member: string, prickleId: string, join: string, leave: string) => ({ id, memberId: member, prickleId, joinTime: join, leaveTime: leave });
const entry = (id: string, member: string, date: string, amount: number, over: Record<string, unknown> = {}) => ({
  id, member_id: member, project_id: "wprj_1", prickle_id: null, entry_date: date, measure: "words", mode: "delta", amount, note: null, tags: [], external_id: null, created_at: `${date}T12:00:00Z`, deleted_at: null, ...over,
});

const book = (id: string, publishedDate: string, over: Partial<BookSeed> = {}): BookSeed => ({ id, member_id: "mbr_AAAAAAAAAAA1", title: `Book ${id}`, published_date: publishedDate, cover_asset_id: null, ...over });

function repos(init: { prickles?: ReturnType<typeof prickle>[]; attendance?: ReturnType<typeof stay>[]; words?: ReturnType<typeof entry>[]; books?: BookSeed[] } = {}) {
  const data = new InMemoryDataset({ prickleTypes: [typeRow], prickles: init.prickles ?? [], attendance: init.attendance ?? [], writingEntries: init.words ?? [], memberBooks: init.books ?? [] } as never);
  return { attendance: new InMemoryAttendanceRepository(data), writing: new InMemoryWritingRepository(data), books: new InMemoryBookRepository(data) };
}

const PRICKLES = [
  prickle("A", "2026-11-18T14:00:00Z", "2026-11-18T15:00:00Z"),
  prickle("B", "2026-10-25T14:00:00Z", "2026-10-25T15:00:00Z"),
  prickle("C", "2026-10-20T14:00:00Z", "2026-10-20T15:00:00Z"), // before the 30 days
  prickle("D", "2026-11-13T04:30:00Z", "2026-11-13T05:30:00Z"), // across Eastern midnight of Nov 12 to 13
];
const STAYS = [
  stay("1", "m1", "A", "2026-11-18T14:00:00Z", "2026-11-18T15:00:00Z"), // 1 h
  stay("2", "m2", "A", "2026-11-18T14:00:00Z", "2026-11-18T16:30:00Z"), // stayed on after the end: clipped to 1 h
  stay("3", "m3", "A", "2026-11-18T13:50:00Z", "2026-11-18T14:30:00Z"), // joined early: clipped to 0.5 h
  stay("4", "m1", "B", "2026-10-25T14:00:00Z", "2026-10-25T14:30:00Z"), // 0.5 h, in the 30 days but not the 7
  stay("5", "m4", "C", "2026-10-20T14:00:00Z", "2026-10-20T15:00:00Z"), // began before the window: not counted
  stay("6", "m5", "D", "2026-11-13T04:59:00Z", "2026-11-13T05:30:00Z"), // 23:59 Eastern on Nov 12: the day before the 7-day window; 31 min
  stay("7", "m6", "D", "2026-11-13T05:00:00Z", "2026-11-13T05:30:00Z"), // exactly midnight Eastern: inside; 30 min
];

describe("books_published", () => {
  it("counts the books members have published so far, all time, as a plain count", async () => {
    const books = [book("a", "2022-10-11"), book("b", "2026-11-19"), book("c", "2026-11-20"), book("d", "2025-03-01", { deleted_at: "2026-01-01T00:00:00Z" })];
    const out = await loadLiveStats(repos({ books }), ["books_published"], NOW);
    expect(out.books_published).toEqual({ value: "2", caption: "books published by members" }); // c is not out yet, d was deleted
  });

  it("counts a book on its publish day (Eastern), and not an hour before", async () => {
    const books = [book("a", "2026-11-20")];
    expect((await loadLiveStats(repos({ books }), ["books_published"], new Date("2026-11-20T04:30:00Z"))).books_published).toBeUndefined(); // 23:30 Nov 19 Eastern
    expect((await loadLiveStats(repos({ books }), ["books_published"], new Date("2026-11-20T05:30:00Z"))).books_published?.value).toBe("1"); // 00:30 Nov 20 Eastern
  });

  it("leaves the figure out when there are no books, so the typed value shows", async () => {
    expect(await loadLiveStats(repos(), ["books_published"], NOW)).toEqual({});
  });

  it("loads nothing from the bookshelf when no figure needs it, and says nothing about titles or authors", async () => {
    const r = repos({ books: [book("a", "2022-10-11")] });
    const spy = vi.spyOn(r.books, "countPublishedOnOrBefore");
    await loadLiveStats(r, ["hours_30d"], NOW);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(await loadLiveStats(r, ["books_published"], NOW))).not.toMatch(/Book a|mbr_/);
  });
});

describe("friendlyFloor", () => {
  it.each([
    [0, "0"],
    [7, "7"],
    [57, "57"],
    [99.9, "99"],
    [100, "100"],
    [891, "890+"],
    [900, "900"],
    [999, "990+"],
    [1234, "1,200+"],
    [54_700, "54,000+"],
    [100_000, "100,000"],
    [128_431, "120,000+"],
  ])("shows %s as %s, never more than it is", (input, shown) => {
    expect(friendlyFloor(input)).toBe(shown);
  });

  it("never rounds up", () => {
    for (const n of [101, 199, 555, 1999, 87_654, 999_999]) expect(Number(friendlyFloor(n).replace(/[,+]/g, ""))).toBeLessThanOrEqual(n);
  });

  it("handles what is not a number", () => {
    expect(friendlyFloor(Number.NaN)).toBe("0");
    expect(friendlyFloor(-5)).toBe("0");
  });
});

describe("Eastern days", () => {
  it("changes the day at Eastern midnight, not UTC midnight", () => {
    expect(easternDay(Date.parse("2026-11-04T04:30:00Z"), 0)).toBe("2026-11-03"); // 23:30 Eastern
    expect(easternDay(Date.parse("2026-11-04T05:30:00Z"), 0)).toBe("2026-11-04"); // 00:30 Eastern
  });

  it("starts a day at its own Eastern midnight, in either offset", () => {
    expect(new Date(easternDayStart(Date.parse("2026-11-19T15:00:00Z"), 6)).toISOString()).toBe("2026-11-13T05:00:00.000Z"); // EST
    expect(new Date(easternDayStart(Date.parse("2026-11-19T15:00:00Z"), 29)).toISOString()).toBe("2026-10-21T04:00:00.000Z"); // EDT
  });

  it("counts calendar days across the spring and fall changes, when a day is 23 or 25 hours", () => {
    const afterSpring = Date.parse("2026-03-10T12:00:00Z"); // spring forward was Sunday Mar 8
    expect(new Date(easternDayStart(afterSpring, 2)).toISOString()).toBe("2026-03-08T05:00:00.000Z"); // Mar 8 00:00 EST
    expect(new Date(easternDayStart(afterSpring, 1)).toISOString()).toBe("2026-03-09T04:00:00.000Z"); // Mar 9 00:00 EDT
    const afterFall = Date.parse("2026-11-03T12:00:00Z"); // fall back was Sunday Nov 1
    expect(new Date(easternDayStart(afterFall, 6)).toISOString()).toBe("2026-10-28T04:00:00.000Z");
    expect(new Date(easternDayStart(afterFall, 1)).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(easternDay(afterFall, 3)).toBe("2026-10-31");
  });
});

describe("the live figures", () => {
  it("adds hours with each stay clipped to its prickle's window", async () => {
    const out = await loadLiveStats(repos({ prickles: PRICKLES, attendance: STAYS }), ["hours_30d"], NOW);
    // 1 + 1 + 0.5 + 0.5 + 31/60 + 0.5 = 4.0166...: shown as 4, never rounded up
    expect(out.hours_30d).toEqual({ value: "4", caption: LIVE_STATS.hours_30d.caption });
  });

  it("counts prickles that writers were in, once each, and writers by Eastern day", async () => {
    const out = await loadLiveStats(repos({ prickles: PRICKLES, attendance: STAYS }), ["prickles_30d", "writers_7d"], NOW);
    expect(out.prickles_30d.value).toBe("3"); // A, B, D; C began before the window
    // m1, m2, m3 (Nov 18) and m6 (exactly Nov 13 00:00 Eastern); m5 joined at 23:59 on Nov 12; m1's other stay is old
    expect(out.writers_7d.value).toBe("4");
  });

  it("counts a member once however often they came, and members who hide from Who's coming like anyone", async () => {
    const attendance = [
      stay("1", "hidden", "A", "2026-11-18T14:00:00Z", "2026-11-18T14:20:00Z"),
      stay("2", "hidden", "A", "2026-11-18T14:30:00Z", "2026-11-18T14:50:00Z"),
      stay("3", "other", "A", "2026-11-18T14:00:00Z", "2026-11-18T14:50:00Z"),
    ];
    const out = await loadLiveStats(repos({ prickles: PRICKLES, attendance }), ["writers_7d", "prickles_30d"], NOW);
    expect(out.writers_7d.value).toBe("2");
    expect(out.prickles_30d.value).toBe("1");
  });

  it("adds only words logged as additions, on days in the window, by Eastern entry date", async () => {
    const words = [
      entry("1", "m1", "2026-11-19", 500),
      entry("2", "m2", "2026-10-21", 300), // the first day of the window
      entry("3", "m2", "2026-10-20", 9999), // the day before
      entry("4", "m1", "2026-11-18", 70_000, { mode: "set_total" }), // a running total: never added
      entry("5", "m1", "2026-11-18", 1234, { deleted_at: "2026-11-19T00:00:00Z" }),
      entry("6", "m1", "2026-11-18", 55, { measure: "pages" }),
      entry("7", "m1", "2026-11-20", 4321), // tomorrow
    ];
    const out = await loadLiveStats(repos({ words }), ["words_30d"], NOW);
    expect(out.words_30d).toEqual({ value: "800", caption: LIVE_STATS.words_30d.caption });
    expect(out.words_30d.caption).toContain("words logged by members in the Hub");
  });

  it("moves the window with the Eastern day: 23:30 on Nov 19 still includes Oct 21; 00:30 on Nov 20 drops it", async () => {
    const words = [entry("1", "m1", "2026-10-21", 1000), entry("2", "m1", "2026-11-19", 5)];
    const before = await loadLiveStats(repos({ words }), ["words_30d"], new Date("2026-11-20T04:30:00Z")); // 23:30 Nov 19 Eastern
    const after = await loadLiveStats(repos({ words }), ["words_30d"], new Date("2026-11-20T05:30:00Z")); // 00:30 Nov 20 Eastern
    expect(before.words_30d.value).toBe("1,000+"); // 1,005, floored
    expect(after.words_30d.value).toBe("5");
  });

  it("leaves out a figure with nothing to show, so the block keeps its typed value", async () => {
    expect(await loadLiveStats(repos(), [...LIVE_STAT_KEYS], NOW)).toEqual({});
    // zero prickles, and a stay that never overlaps its prickle's window
    const none = await loadLiveStats(repos({ prickles: [prickle("A", "2026-11-18T14:00:00Z", "2026-11-18T15:00:00Z")], attendance: [stay("1", "m1", "A", "2026-11-18T15:30:00Z", "2026-11-18T16:00:00Z")] }), ["hours_30d"], NOW);
    expect(none).toEqual({});
  });

  it("ignores a stay whose prickle is gone, and asks only for the data the figures need", async () => {
    const r = repos({ attendance: [stay("1", "m1", "gone", "2026-11-18T14:00:00Z", "2026-11-18T15:00:00Z")] });
    const stays = vi.spyOn(r.attendance, "staysJoinedBetween");
    const words = vi.spyOn(r.writing, "wordsLoggedBetween");
    expect(await loadLiveStats(r, ["hours_30d", "writers_7d"], NOW)).toEqual({});
    expect(stays).toHaveBeenCalledTimes(1); // one pass for both figures
    expect(words).not.toHaveBeenCalled();
  });

  it("reads nothing for no keys or unknown ones", async () => {
    const r = repos();
    const stays = vi.spyOn(r.attendance, "staysJoinedBetween");
    expect(await loadLiveStats(r, [], NOW)).toEqual({});
    expect(await loadLiveStats(r, ["no_such_figure", "constructor"], NOW)).toEqual({});
    expect(stays).not.toHaveBeenCalled();
  });

  it("lets a failed read through to the caller", async () => {
    const r = repos();
    vi.spyOn(r.attendance, "staysJoinedBetween").mockRejectedValue(new Error("db down"));
    await expect(loadLiveStats(r, ["hours_30d"], NOW)).rejects.toThrow("db down");
  });

  it("lists every registered figure in the editor's choices, by its label", () => {
    expect(LIVE_STAT_OPTIONS.map((o) => o.value)).toEqual(LIVE_STAT_KEYS);
    for (const key of LIVE_STAT_KEYS) {
      expect(isLiveStatKey(key)).toBe(true);
      expect(LIVE_STAT_OPTIONS.find((o) => o.value === key)?.label).toBe(LIVE_STATS[key].label);
      expect(LIVE_STATS[key].caption.length).toBeGreaterThan(10);
    }
    expect(isLiveStatKey("toString")).toBe(false);
  });
});

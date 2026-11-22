import { describe, expect, it } from "vitest";
import { MAX_WORK_TITLE_LENGTH, buildWorks, groupShownWorks, stepsCountedWhileMember, isFeaturedWork, isPastDrafting, parseWork, summarizeWorks, workKey } from "@/lib/finishers-works";
import { PROJECT_PHASES } from "@/lib/writing-projects";
import type { Milestone, ShownWorkStep } from "@/lib/data/milestones";

const row = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: "mlst_AAAAAAAAAAA1",
  memberId: "mbr_AAAAAAAAAAA1",
  kind: "the_end",
  projectId: null,
  bookId: null,
  title: null,
  status: "confirmed",
  source: "member",
  achievedOn: null,
  storyBefore: null,
  storyAfter: null,
  visibility: "community",
  consentTestimonial: false,
  confirmedAt: "2026-11-20T12:00:00Z",
  createdAt: "2026-11-20T12:00:00Z",
  ...overrides,
});

describe("workKey", () => {
  it("is the project, else the book, else the title in lower case with squashed spaces, else empty", () => {
    expect(workKey({ projectId: "wpr_1", bookId: "book_1", title: "x" })).toBe("wpr_1");
    expect(workKey({ projectId: null, bookId: "book_1", title: "x" })).toBe("book_1");
    expect(workKey({ projectId: null, bookId: null, title: "  A   Fake  NOVEL " })).toBe("title:a fake novel");
    expect(workKey({ projectId: null, bookId: null, title: "   " })).toBe("");
    expect(workKey({ projectId: null, bookId: null, title: null })).toBe("");
  });
});

describe("parseWork", () => {
  it("takes a project or a book as given, and otherwise needs a title of a sensible length", () => {
    expect(parseWork({ projectId: "wpr_1", title: "ignored" })).toEqual({ projectId: "wpr_1", bookId: null, title: null });
    expect(parseWork({ bookId: "book_1" })).toEqual({ projectId: null, bookId: "book_1", title: null });
    expect(parseWork({ title: "  A  Fake   Work " })).toEqual({ projectId: null, bookId: null, title: "A Fake Work" });
    expect(parseWork({})).toHaveProperty("error");
    expect(parseWork({ title: " " })).toHaveProperty("error");
    expect(parseWork({ title: "x".repeat(MAX_WORK_TITLE_LENGTH) })).toMatchObject({ title: "x".repeat(MAX_WORK_TITLE_LENGTH) });
    expect(parseWork({ title: "x".repeat(MAX_WORK_TITLE_LENGTH + 1) })).toHaveProperty("error");
  });
});

describe("isPastDrafting", () => {
  it("is true from the first read-through on, false before, and for hibernating or no phase", () => {
    const drafting = PROJECT_PHASES.indexOf("drafting");
    for (const [i, phase] of PROJECT_PHASES.entries()) {
      expect(isPastDrafting(phase)).toBe(i > drafting && phase !== "hibernating");
    }
    expect(isPastDrafting(null)).toBe(false);
    expect(isPastDrafting("not a phase")).toBe(false);
  });
});

describe("buildWorks", () => {
  const projects = [
    { id: "wpr_1", title: "One", phase: "revising" },
    { id: "wpr_2", title: "Two", phase: "drafting" },
  ];

  it("lists projects, then books, with a book that has a project folded into it", () => {
    const works = buildWorks(projects, [{ id: "book_1", title: "One Book", projectId: "wpr_1" }, { id: "book_2", title: "Loose", projectId: null }], []);
    expect(works.map((w) => [w.key, w.title, w.published, w.bookId])).toEqual([
      ["wpr_1", "One", true, "book_1"],
      ["wpr_2", "Two", false, null],
      ["book_2", "Loose", true, "book_2"],
    ]);
  });

  it("keeps a book whose project is gone as its own work, under the project key milestones use", () => {
    const works = buildWorks([], [{ id: "book_1", title: "Orphan", projectId: "wpr_gone" }], [row({ projectId: "wpr_gone", bookId: "book_1" })]);
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({ key: "wpr_gone", title: "Orphan", published: true });
    expect(works[0].milestones.the_end).toBeDefined();
  });

  it("attaches each milestone to its work by project, by book, or by title, and keeps works only a milestone knows", () => {
    const works = buildWorks(
      projects,
      [{ id: "book_2", title: "Loose", projectId: null }],
      [
        row({ id: "m1", projectId: "wpr_1" }),
        row({ id: "m2", kind: "publish_ready", bookId: "book_2" }),
        row({ id: "m3", title: "A Fake Memoir" }),
        row({ id: "m4", kind: "publish_ready", title: "a fake  memoir" }),
        row({ id: "m5" }),
      ],
    );
    const by = (title: string | null) => works.find((w) => w.title === title)!;
    expect(by("One").milestones.the_end?.id).toBe("m1");
    expect(by("Loose").milestones.publish_ready?.id).toBe("m2");
    expect(Object.keys(by("A Fake Memoir").milestones).sort()).toEqual(["publish_ready", "the_end"]);
    expect(works.find((w) => w.key === "")?.milestones.the_end?.id).toBe("m5");
    expect(works).toHaveLength(5);
  });

  it("features works with a milestone, a book or a later phase, and not the rest", () => {
    const works = buildWorks(
      [...projects, { id: "wpr_3", title: "Three", phase: "hibernating" }, { id: "wpr_4", title: "Four", phase: "drafting" }],
      [],
      [row({ projectId: "wpr_4" })],
    );
    expect(works.filter(isFeaturedWork).map((w) => w.title)).toEqual(["One", "Four"]);
  });
});

describe("summarizeWorks", () => {
  it("counts each work once at its highest step, in plain counts with no title words, from confirmed milestones and the Bookshelf only", () => {
    const works = buildWorks(
      [
        { id: "wpr_1", title: "One", phase: "revising" },
        { id: "wpr_2", title: "Two", phase: "revising" },
        { id: "wpr_3", title: "Three", phase: "revising" },
        { id: "wpr_4", title: "Four", phase: "revising" },
      ],
      [{ id: "book_1", title: "One Book", projectId: "wpr_1" }],
      [
        row({ id: "a", projectId: "wpr_1", status: "confirmed" }),
        row({ id: "b", projectId: "wpr_2", kind: "publish_ready" }),
        row({ id: "c", projectId: "wpr_2" }),
        row({ id: "d", projectId: "wpr_3" }),
        row({ id: "e", projectId: "wpr_4", status: "proposed", confirmedAt: null }),
        row({ id: "f", projectId: "wpr_4", kind: "publish_ready", status: "declined", confirmedAt: null }),
      ],
    );
    expect(summarizeWorks(works)).toBe("3 works · 1 published · 1 ready to publish · 1 finished");
  });

  it("never says Author for a work that is not publish-ready, and says nothing when there is nothing to say", () => {
    const works = buildWorks([{ id: "wpr_1", title: "One", phase: "revising" }], [], [row({ projectId: "wpr_1" })]);
    expect(summarizeWorks(works)).toBe("1 work · 1 finished");
    expect(summarizeWorks(works)).not.toMatch(/Author|Finisher|ready to publish/);
    expect(summarizeWorks(buildWorks([], [], [row({ status: "proposed", confirmedAt: null })]))).toBeNull();
    expect(summarizeWorks([])).toBeNull();
  });

  it("says where each work stands, once, as the badges' counts would not: a published work is also a finished one but is counted only as published", () => {
    const projects = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `wpr_${n}`, title: `Work ${n}`, phase: "revising" }));
    const works = buildWorks(
      projects,
      [{ id: "book_1", title: "Book 1", projectId: "wpr_1" }],
      [
        row({ id: "a", projectId: "wpr_1" }),
        row({ id: "b", projectId: "wpr_1", kind: "publish_ready" }),
        row({ id: "c", projectId: "wpr_2", kind: "publish_ready" }),
        row({ id: "d", projectId: "wpr_2" }),
        row({ id: "e", projectId: "wpr_3", kind: "publish_ready" }),
        row({ id: "f", projectId: "wpr_4" }),
        row({ id: "g", projectId: "wpr_5" }),
        row({ id: "h", projectId: "wpr_6" }),
      ],
    );
    expect(summarizeWorks(works)).toBe("6 works · 1 published · 2 ready to publish · 3 finished");
  });

  it("uses the plural for several works", () => {
    const works = buildWorks([], [], [row({ id: "a", title: "A" }), row({ id: "b", title: "B" })]);
    expect(summarizeWorks(works)).toBe("2 works · 2 finished");
  });
});

describe("groupShownWorks (the strips)", () => {
  const step = (overrides: Partial<ShownWorkStep> = {}): ShownWorkStep => ({
    workNo: 1,
    kind: "the_end",
    workTitle: "A Fake Novel",
    achievedOn: null,
    storyBefore: null,
    storyAfter: null,
    visibility: "public",
    ...overrides,
  });

  it("draws nothing for no rows", () => {
    expect(groupShownWorks([])).toEqual([]);
  });

  it("puts one work's steps in the order of the journey whatever order they come in: 1, 2 and 3 milestones", () => {
    const one = groupShownWorks([step()]);
    expect(one).toHaveLength(1);
    expect(one[0].steps.map((s) => s.kind)).toEqual(["the_end"]);
    const two = groupShownWorks([step({ kind: "publish_ready" }), step()]);
    expect(two[0].steps.map((s) => s.kind)).toEqual(["the_end", "publish_ready"]);
    const three = groupShownWorks([step({ kind: "published" }), step({ kind: "publish_ready" }), step()]);
    expect(three).toHaveLength(1);
    expect(three[0].title).toBe("A Fake Novel");
    expect(three[0].steps.map((s) => s.kind)).toEqual(["the_end", "publish_ready", "published"]);
  });

  it("keeps several works apart, in their numbered order, each at its own phase (an untitled project included)", () => {
    const works = groupShownWorks([
      step({ workNo: 3, kind: "published", workTitle: "A Loose Fake Book" }),
      step({ workNo: 1 }),
      step({ workNo: 1, kind: "publish_ready" }),
      step({ workNo: 2, workTitle: null, kind: "publish_ready" }),
    ]);
    expect(works.map((w) => [w.title, w.steps.map((s) => s.kind)])).toEqual([
      ["A Fake Novel", ["the_end", "publish_ready"]],
      [null, ["publish_ready"]],
      ["A Loose Fake Book", ["published"]],
    ]);
  });

  it("shows a work's name even when only a later row knows it, and one Published for two books under one project (the earliest day)", () => {
    const works = groupShownWorks([
      step({ workTitle: null }),
      step({ kind: "published", achievedOn: "2026-09-01" }),
      step({ kind: "published", achievedOn: "2026-02-01", workTitle: "An Earlier Fake Book" }),
      step({ kind: "published", achievedOn: null }),
    ]);
    expect(works[0].title).toBe("A Fake Novel");
    expect(works[0].steps.filter((s) => s.kind === "published")).toHaveLength(1);
    expect(works[0].steps.find((s) => s.kind === "published")?.achievedOn).toBe("2026-02-01");
  });
});

describe("the date rule for Published (books published before the member joined)", () => {
  const books = [
    { id: "book_old", title: "An Earlier Fake Book", projectId: null, publishedDate: "2026-02-28" },
    { id: "book_join", title: "A Join Day Fake Book", projectId: null, publishedDate: "2026-03-01" },
    { id: "book_new", title: "A Later Fake Book", projectId: "wpr_1", publishedDate: "2026-09-01" },
  ];
  const projects = [{ id: "wpr_1", title: "A Fake Novel", phase: "revising" }];
  const published = (joined: string | null) => buildWorks(projects, books, [], joined).filter((w) => w.published).map((w) => w.title).sort();

  it("keeps a book from before off the Published list (it is still a work), counts the join day and later, and counts all with no join date", () => {
    expect(published("2026-03-01T15:00:00Z")).toEqual(["A Fake Novel", "A Join Day Fake Book"]);
    expect(buildWorks(projects, books, [], "2026-03-01").map((w) => w.title)).toContain("An Earlier Fake Book");
    expect(published(null)).toEqual(["A Fake Novel", "A Join Day Fake Book", "An Earlier Fake Book"]);
  });

  it("leaves a book with no date counted, and the summary line says Published Author only for the books that count", () => {
    expect(buildWorks([], [{ id: "book_x", title: "An Undated Fake Book", projectId: null }], [], "2026-03-01")[0].published).toBe(true);
    expect(summarizeWorks(buildWorks(projects, books, [], "2026-03-01"))).toBe("2 works · 2 published");
    expect(summarizeWorks(buildWorks(projects, books, [], "2027-01-01"))).toBeNull();
  });

  it("drops the Published step of an earlier book from a strip, never a milestone, and keeps everything with no join date", () => {
    const step = (kind: "the_end" | "published", achievedOn: string | null) => ({ workNo: 1, kind, workTitle: "A Fake Novel", achievedOn, storyBefore: null, storyAfter: null, visibility: "public" as const });
    const steps = [step("the_end", "2020-01-01"), step("published", "2026-02-28")];
    expect(stepsCountedWhileMember(steps, "2026-03-01").map((s) => s.kind)).toEqual(["the_end"]);
    expect(stepsCountedWhileMember([step("the_end", null), step("published", "2026-03-01")], "2026-03-01").map((s) => s.kind)).toEqual(["the_end", "published"]);
    expect(stepsCountedWhileMember(steps, null)).toHaveLength(2);
    expect(groupShownWorks(stepsCountedWhileMember([step("published", "2026-02-28")], "2026-03-01"))).toEqual([]);
  });
});

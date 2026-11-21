import { describe, expect, it } from "vitest";
import { MAX_WORK_TITLE_LENGTH, buildWorks, isFeaturedWork, isPastDrafting, parseWork, summarizeTitles, workKey } from "@/lib/finishers-works";
import { PROJECT_PHASES } from "@/lib/writing-projects";
import type { Milestone } from "@/lib/data/milestones";

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

describe("summarizeTitles", () => {
  it("counts each work once at its highest rung, from confirmed milestones and the Bookshelf only", () => {
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
    expect(summarizeTitles(works)).toBe("Published Author of 1 work · Author of 1 work · Finisher of 1 work");
  });

  it("never says Author for a work that is not publish-ready, and says nothing when there is nothing to say", () => {
    const works = buildWorks([{ id: "wpr_1", title: "One", phase: "revising" }], [], [row({ projectId: "wpr_1" })]);
    expect(summarizeTitles(works)).toBe("Finisher of 1 work");
    expect(summarizeTitles(works)).not.toMatch(/Author/);
    expect(summarizeTitles(buildWorks([], [], [row({ status: "proposed", confirmedAt: null })]))).toBeNull();
    expect(summarizeTitles([])).toBeNull();
  });

  it("uses the plural for several works", () => {
    const works = buildWorks([], [], [row({ id: "a", title: "A" }), row({ id: "b", title: "B" })]);
    expect(summarizeTitles(works)).toBe("Finisher of 2 works");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeAuthorName, normalizeKey, parseAuthorSpec, planAuthors, type PlanBook, type PlanMember } from "@/scripts/set-book-authors-spec";

describe("normalizeAuthorName", () => {
  it("trims, collapses spaces and drops a leading By", () => {
    expect(normalizeAuthorName("  By   Ada   Example ")).toEqual({ ok: true, name: "Ada Example" });
    expect(normalizeAuthorName("J. R. Example")).toEqual({ ok: true, name: "J. R. Example" });
    expect(normalizeAuthorName("Zoë Éxample-Ng")).toEqual({ ok: true, name: "Zoë Éxample-Ng" });
  });

  it.each([
    ["", "is empty"],
    ["   ", "is empty"],
    ["A", "is too short to be a name"],
    ["ada@example.test", "looks like an email address"],
    ["https://example.test/ada", "looks like a web address"],
    ["www.example.test", "looks like a web address"],
    ["adaexample.com", "looks like a web address"],
    ["<b>Ada</b>", "has characters a name does not"],
    ["Ada Example 2", "has digits, which a name does not"],
    ["...", "has no letters"],
    ["One Two Three Four Five Six Seven", "has more than 6 words"],
    ["x".repeat(81), "is longer than 80 characters"],
  ])("refuses %j", (raw, reason) => {
    expect(normalizeAuthorName(raw)).toEqual({ ok: false, reason });
  });

  it("refuses what is not text", () => {
    expect(normalizeAuthorName(7)).toEqual({ ok: false, reason: "is not text" });
    expect(normalizeAuthorName(undefined)).toEqual({ ok: false, reason: "is not text" });
  });
});

describe("normalizeKey", () => {
  it("ignores accents, case, punctuation, ampersands and spacing", () => {
    expect(normalizeKey("  The  Café — Tales & Letters! ")).toBe("the cafe tales and letters");
    expect(normalizeKey("The Cafe: Tales and Letters")).toBe("the cafe tales and letters");
    expect(normalizeKey("It’s a Book")).toBe(normalizeKey("it's a book"));
  });
});

describe("parseAuthorSpec", () => {
  it("accepts complete entries, with the name cleaned and memberName optional", () => {
    expect(parseAuthorSpec([{ title: " A Book ", name: "By Ada  Example" }, { title: "B", name: "Bo Example", memberName: " Bo L. " }])).toEqual({
      ok: true,
      entries: [
        { title: "A Book", name: "Ada Example" },
        { title: "B", name: "Bo Example", memberName: "Bo L." },
      ],
    });
  });

  it("lists every problem by position without repeating a name", () => {
    const result = parseAuthorSpec([{ title: "Fine", name: "Ada Example" }, { title: "", name: "ada@example.test" }, "nope", { title: "T", name: "Ok Name", memberName: 5 }]);
    expect(result).toEqual({
      ok: false,
      errors: ["Entry 2: title is missing", "Entry 2: name looks like an email address", "Entry 3 must be an object", "Entry 4: memberName must be text when given"],
    });
    expect(JSON.stringify(result)).not.toContain("ada@example.test");
  });

  it("refuses an empty spec and one that is not an array", () => {
    expect(parseAuthorSpec([])).toEqual({ ok: false, errors: ["The spec must be a non-empty JSON array"] });
    expect(parseAuthorSpec({})).toEqual({ ok: false, errors: ["The spec must be a non-empty JSON array"] });
  });
});

describe("planAuthors", () => {
  const members: PlanMember[] = [
    { id: "m1", name: "Ada Legalname", displayName: "Ada E." },
    { id: "m2", name: "Bo Legalname", displayName: null },
  ];
  const book = (id: string, member_id: string, title: string, pen_name: string | null = null): PlanBook => ({ id, member_id, title, pen_name });
  const spec = (title: string, name = "Listed Name", memberName?: string) => ({ title, name, ...(memberName ? { memberName } : {}) });

  it("matches one live book by title, ignoring case, accents and punctuation, and would set its pen name", () => {
    const plan = planAuthors([spec("the cafe: tales")], [book("b1", "m1", "The Café Tales")], members);
    expect(plan.outcomes).toEqual([{ kind: "set", index: 0, title: "the cafe: tales", bookId: "b1", name: "Listed Name" }]);
    expect(plan.counts).toEqual({ entries: 1, matched: 1, unmatched: 0, ambiguous: 0, alreadyHasPenName: 0, wouldSet: 1, wouldAddAuthorLine: 0, sameAsDisplayName: 0, wouldReplaceDisplayName: 1, skippedDisplayName: 0 });
  });

  it("never overwrites a pen name, and counts empty ones as none", () => {
    const plan = planAuthors([spec("One"), spec("Two")], [book("b1", "m1", "One", "Member's Choice"), book("b2", "m1", "Two", "  ")], members);
    expect(plan.outcomes.map((o) => o.kind)).toEqual(["has_pen_name", "set"]);
    expect(plan.counts).toMatchObject({ matched: 2, alreadyHasPenName: 1, wouldSet: 1 });
  });

  it("skips and counts a title nobody has", () => {
    const plan = planAuthors([spec("Missing")], [book("b1", "m1", "Other")], members);
    expect(plan.outcomes).toEqual([{ kind: "unmatched", index: 0, title: "Missing" }]);
    expect(plan.counts).toMatchObject({ unmatched: 1, wouldSet: 0 });
  });

  it("skips two books with one title unless the member says which, by account name or display name", () => {
    const books = [book("b1", "m1", "Twin"), book("b2", "m2", "Twin")];
    expect(planAuthors([spec("Twin")], books, members).outcomes).toEqual([{ kind: "ambiguous", index: 0, title: "Twin", why: "several_books" }]);
    expect(planAuthors([spec("Twin", "N", "bo legalname")], books, members).outcomes).toMatchObject([{ kind: "set", bookId: "b2" }]);
    expect(planAuthors([spec("Twin", "N", "Ada E.")], books, members).outcomes).toMatchObject([{ kind: "set", bookId: "b1" }]);
    expect(planAuthors([spec("Twin", "N", "Nobody Here")], books, members).outcomes).toMatchObject([{ kind: "unmatched" }]);
  });

  it("treats two entries for one book as one when the names agree and as ambiguous when they differ", () => {
    const books = [book("b1", "m1", "Same")];
    const agree = planAuthors([spec("Same", "Ada Example"), spec("same", "Ada Example")], books, members);
    expect(agree.outcomes.map((o) => o.kind)).toEqual(["set", "has_pen_name"]);
    expect(agree.counts.wouldSet).toBe(1);
    const differ = planAuthors([spec("Same", "Ada Example"), spec("Same", "Bo Example")], books, members);
    expect(differ.outcomes).toEqual([
      { kind: "ambiguous", index: 0, title: "Same", why: "conflicting_names" },
      { kind: "ambiguous", index: 1, title: "Same", why: "conflicting_names" },
    ]);
  });

  it("is idempotent: after the names are set, a second plan sets nothing", () => {
    const books = [book("b1", "m1", "One"), book("b2", "m2", "Two")];
    const entries = [spec("One", "Ada Example"), spec("Two", "Bo Example")];
    const first = planAuthors(entries, books, members);
    expect(first.counts.wouldSet).toBe(2);
    const after = books.map((b) => ({ ...b, pen_name: first.outcomes.find((o) => o.kind === "set" && o.bookId === b.id) ? "Set" : b.pen_name }));
    const second = planAuthors(entries, after, members);
    expect(second.counts).toMatchObject({ wouldSet: 0, alreadyHasPenName: 2 });
  });

  it("says what each name changes on the web, and can leave books whose member has a display name alone", () => {
    const books = [book("b1", "m1", "Has Name Same"), book("b2", "m1", "Has Name Other"), book("b3", "m2", "No Name")];
    const entries = [spec("Has Name Same", "ada e"), spec("Has Name Other", "Someone Else"), spec("No Name", "Bo Example")];
    const all = planAuthors(entries, books, members);
    expect(all.counts).toMatchObject({ wouldSet: 3, sameAsDisplayName: 1, wouldReplaceDisplayName: 1, wouldAddAuthorLine: 1, skippedDisplayName: 0 });
    const careful = planAuthors(entries, books, members, { skipWithDisplayName: true });
    expect(careful.outcomes.map((o) => o.kind)).toEqual(["has_display_name", "has_display_name", "set"]);
    expect(careful.counts).toMatchObject({ wouldSet: 1, wouldAddAuthorLine: 1, skippedDisplayName: 2, matched: 3 });
  });
});

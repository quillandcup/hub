import { describe, expect, it } from "vitest";
import { itemState, planFullTree, visibilityFromPublishing } from "@/lib/courses/visibility";

/**
 * The rule that works out what members get from the settings, with the same cases as the database's own
 * (supabase/tests/database/course_publishing_settings.test.sql, `course_item_state` and
 * `recompute_course_states`): the Kajabi sync computes states here, a Hub-owned course's are computed in
 * the database, and they must give the same answer. Change one, change the other.
 */

describe("visibilityFromPublishing", () => {
  it("is open for published, coming soon for locked and drip, and hidden for anything else", () => {
    expect(visibilityFromPublishing("published")).toBe("open");
    expect(visibilityFromPublishing("locked")).toBe("coming_soon");
    expect(visibilityFromPublishing("drip")).toBe("coming_soon");
    expect(visibilityFromPublishing("draft")).toBe("hidden");
    expect(visibilityFromPublishing(null)).toBe("hidden");
    expect(visibilityFromPublishing("whatever")).toBe("hidden");
  });
});

describe("itemState", () => {
  it("follows what is above when told to, and is never more visible than it", () => {
    expect(itemState("inherit", "coming_soon")).toBe("coming_soon");
    expect(itemState("published", "coming_soon")).toBe("coming_soon");
    expect(itemState("locked", "open")).toBe("coming_soon");
    expect(itemState("draft", "open")).toBe("hidden");
    expect(itemState("published", "hidden")).toBe("hidden");
    expect(itemState("inherit", "open")).toBe("open");
  });
});

describe("planFullTree with a course's own setting", () => {
  // The database test's course: module A (follows) holding submodule A1 (follows) with a lesson that follows and
  // a lesson with its own published setting; module B (locked) with a lesson that follows; a lesson in no module.
  const modules = (a = "inherit") => [
    { kajabiId: "A", parentKajabiId: null, publishingOption: a },
    { kajabiId: "B", parentKajabiId: null, publishingOption: "locked" },
    { kajabiId: "A1", parentKajabiId: "A", publishingOption: "inherit" },
  ];
  const lessons = (bLesson = "inherit") => [
    { kajabiId: "A1L", moduleKajabiId: "A1", publishingOption: "inherit" },
    { kajabiId: "AOwn", moduleKajabiId: "A", publishingOption: "published" },
    { kajabiId: "BL", moduleKajabiId: "B", publishingOption: bLesson },
    { kajabiId: "Loose", moduleKajabiId: null, publishingOption: "inherit" },
  ];
  const states = (course: string, a?: string, bLesson?: string) => {
    const tree = planFullTree(modules(a), lessons(bLesson), course);
    return Object.fromEntries([...tree.modules, ...tree.lessons]);
  };

  it("hides everything in a draft course, even what has its own published setting", () => {
    expect(states("draft")).toEqual({ A: "hidden", B: "hidden", A1: "hidden", A1L: "hidden", AOwn: "hidden", BL: "hidden", Loose: "hidden" });
  });

  it("opens what follows a published course, and a locked module is coming soon", () => {
    expect(states("published")).toEqual({ A: "open", B: "coming_soon", A1: "open", A1L: "open", AOwn: "open", BL: "coming_soon", Loose: "open" });
  });

  it("makes everything at most coming soon in a locked course", () => {
    expect(states("locked")).toEqual({ A: "coming_soon", B: "coming_soon", A1: "coming_soon", A1L: "coming_soon", AOwn: "coming_soon", BL: "coming_soon", Loose: "coming_soon" });
  });

  it("hides what is under a draft module, its submodule and a lesson with its own published setting included", () => {
    expect(states("published", "draft")).toEqual({ A: "hidden", B: "coming_soon", A1: "hidden", A1L: "hidden", AOwn: "hidden", BL: "coming_soon", Loose: "open" });
  });

  it("allows a lesson published in a locked module, and shows it as coming soon", () => {
    expect(states("published", "inherit", "published").BL).toBe("coming_soon");
  });

  it("limits nothing by an imported course, which is published", () => {
    const tree = planFullTree([{ kajabiId: "m", parentKajabiId: null, publishingOption: "published" }], [{ kajabiId: "l", moduleKajabiId: "m", publishingOption: "published" }]);
    expect(tree.modules.get("m")).toBe("open");
    expect(tree.lessons.get("l")).toBe("open");
  });

  it("leaves what Kajabi has with no setting hidden, as it always was", () => {
    const tree = planFullTree([{ kajabiId: "m", parentKajabiId: null, publishingOption: null }], [{ kajabiId: "l", moduleKajabiId: null, publishingOption: null }]);
    expect(tree.modules.get("m")).toBe("hidden");
    expect(tree.lessons.get("l")).toBe("hidden");
  });
});

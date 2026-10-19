import { describe, it, expect } from "vitest";
import { explainCourse, type ExplainLessonIn, type ExplainModuleIn } from "@/lib/courses/explain";
import { planVisibleTree } from "@/lib/courses/visibility";

const mod = (kajabiId: string, publishingOption: string | null, parentKajabiId: string | null = null, position = 1): ExplainModuleIn => ({
  kajabiId,
  parentKajabiId,
  position,
  title: kajabiId,
  publishingOption,
});
const lesson = (kajabiId: string, publishingOption: string | null, moduleKajabiId: string | null = null, position = 1): ExplainLessonIn => ({
  kajabiId,
  moduleKajabiId,
  position,
  title: kajabiId,
  publishingOption,
});

describe("explainCourse", () => {
  // The real case: published weeks inside a locked module, and draft leftovers.
  const modules = [mod("Module 1", "draft", null, 1), mod("Module 2", "locked", null, 2), mod("Week 1", "published", "Module 2", 1)];
  const lessons = [lesson("Welcome", "draft", "Module 1"), lesson("Reader expectations", "published", "Week 1"), lesson("Loose", "published")];
  const course = explainCourse(modules, lessons);

  it("says a published lesson inside a locked module is coming soon because of that module", () => {
    const week = course.modules[1].children[0];
    expect(week).toMatchObject({ title: "Week 1", state: "coming_soon", reason: "Inside “Module 2” (Locked)" });
    expect(week.lessons[0]).toMatchObject({ state: "coming_soon", reason: "Inside “Module 2” (Locked)" });
  });

  it("names the item's own Kajabi setting when that decides it", () => {
    expect(course.modules[0]).toMatchObject({ title: "Module 1", state: "hidden", reason: "Draft in Kajabi" });
    expect(course.modules[1]).toMatchObject({ state: "coming_soon", reason: "Locked in Kajabi" });
    expect(course.modules[0].lessons[0]).toMatchObject({ state: "hidden", reason: "Draft in Kajabi" });
  });

  it("calls a published lesson outside any limiting module published", () => {
    expect(course.loose).toMatchObject([{ title: "Loose", state: "open", reason: "Published" }]);
  });

  it("totals lessons by state", () => {
    expect(course.totals).toEqual({ open: 1, coming_soon: 1, hidden: 1 });
  });

  it("agrees with what members get: the same planVisibleTree result", () => {
    const tree = planVisibleTree(
      modules.map((m) => ({ kajabiId: m.kajabiId, parentKajabiId: m.parentKajabiId, publishingOption: m.publishingOption })),
      lessons.map((l) => ({ kajabiId: l.kajabiId, moduleKajabiId: l.moduleKajabiId, publishingOption: l.publishingOption }))
    );
    expect(course.totals.open).toBe([...tree.lessons.values()].filter((v) => v === "open").length);
    expect(course.totals.coming_soon).toBe([...tree.lessons.values()].filter((v) => v === "coming_soon").length);
  });

  it("finds the nearest limiting module, through nested weeks", () => {
    const nested = explainCourse(
      [mod("Top", "draft"), mod("Mid", "published", "Top"), mod("Leaf", "published", "Mid")],
      [lesson("L", "published", "Leaf")]
    );
    const leaf = nested.modules[0].children[0].children[0];
    expect(leaf).toMatchObject({ state: "hidden", reason: "Inside “Top” (Draft)" });
    expect(leaf.lessons[0]).toMatchObject({ state: "hidden", reason: "Inside “Top” (Draft)" });
  });

  it("explains an unrecognised setting and a missing parent plainly", () => {
    const odd = explainCourse([mod("M", "weird"), mod("Orphan", "published", "gone")], [lesson("L", null, "M")]);
    expect(odd.modules.find((m) => m.title === "M")).toMatchObject({ state: "hidden", reason: "weird in Kajabi" });
    // The lesson's own missing setting hides it too, and its own setting is what's reported first.
    expect(odd.modules.find((m) => m.title === "M")!.lessons[0]).toMatchObject({ state: "hidden", reason: "no setting in Kajabi" });
    expect(odd.modules.find((m) => m.title === "Orphan")).toMatchObject({ state: "hidden", reason: "Its parent module is missing from Kajabi's response" });
  });

  it("orders by position, then title", () => {
    const ordered = explainCourse([mod("B", "published", null, 2), mod("A", "published", null, 1)], [lesson("y", "published", "A", 2), lesson("x", "published", "A", 1)]);
    expect(ordered.modules.map((m) => m.title)).toEqual(["A", "B"]);
    expect(ordered.modules[0].lessons.map((l) => l.title)).toEqual(["x", "y"]);
  });

  it("labels a missing setting", () => {
    expect(explainCourse([], [lesson("L", null)]).loose[0].reason).toBe("no setting in Kajabi");
  });
});

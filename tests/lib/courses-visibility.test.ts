import { describe, it, expect } from "vitest";
import { planFullTree, planVisibleTree, slugifyTitle, visibilityFromPublishing } from "@/lib/courses/visibility";

const mod = (kajabiId: string, publishingOption: string | null, parentKajabiId: string | null = null) => ({
  kajabiId,
  parentKajabiId,
  publishingOption,
});
const lesson = (kajabiId: string, publishingOption: string | null, moduleKajabiId: string | null = null) => ({
  kajabiId,
  moduleKajabiId,
  publishingOption,
});

describe("visibilityFromPublishing", () => {
  it("opens published, shows locked and drip as coming soon, hides everything else", () => {
    expect(visibilityFromPublishing("published")).toBe("open");
    expect(visibilityFromPublishing("locked")).toBe("coming_soon");
    expect(visibilityFromPublishing("drip")).toBe("coming_soon");
    expect(visibilityFromPublishing("draft")).toBe("hidden");
    expect(visibilityFromPublishing("something-new")).toBe("hidden");
    expect(visibilityFromPublishing(null)).toBe("hidden");
  });
});

describe("planVisibleTree", () => {
  it("never shows a lesson more than the module it sits in", () => {
    const tree = planVisibleTree(
      [mod("open", "published"), mod("soon", "locked"), mod("draft", "draft")],
      [
        lesson("a", "published", "open"),
        lesson("b", "published", "soon"),
        lesson("c", "locked", "open"),
        lesson("d", "published", "draft"),
        lesson("e", "locked", "draft"),
      ]
    );
    expect(Object.fromEntries(tree.lessons)).toEqual({ a: "open", b: "coming_soon", c: "coming_soon" });
    expect(Object.fromEntries(tree.modules)).toEqual({ open: "open", soon: "coming_soon" });
  });

  it("hides draft lessons even in an open module", () => {
    const tree = planVisibleTree([mod("m", "published")], [lesson("a", "draft", "m"), lesson("b", "published", "m")]);
    expect([...tree.lessons.keys()]).toEqual(["b"]);
  });

  it("limits a nested module by its parent", () => {
    const tree = planVisibleTree(
      [mod("parent", "locked"), mod("week", "published", "parent"), mod("hiddenParent", "draft"), mod("hiddenWeek", "published", "hiddenParent")],
      [lesson("a", "published", "week"), lesson("b", "published", "hiddenWeek")]
    );
    expect(tree.modules.get("week")).toBe("coming_soon");
    expect(tree.modules.has("hiddenWeek")).toBe(false);
    expect(tree.lessons.get("a")).toBe("coming_soon");
    expect(tree.lessons.has("b")).toBe(false);
  });

  it("treats a lesson with no module as its own state", () => {
    const tree = planVisibleTree([], [lesson("a", "published"), lesson("b", "locked"), lesson("c", "draft")]);
    expect(Object.fromEntries(tree.lessons)).toEqual({ a: "open", b: "coming_soon" });
  });

  it("hides a module whose parent is unknown or whose parents form a cycle", () => {
    const tree = planVisibleTree(
      [mod("orphan", "published", "missing"), mod("x", "published", "y"), mod("y", "published", "x")],
      [lesson("a", "published", "orphan")]
    );
    expect(tree.modules.size).toBe(0);
    expect(tree.lessons.size).toBe(0);
  });
});

describe("planFullTree", () => {
  const modules = [mod("open", "published"), mod("soon", "locked"), mod("draft", "draft"), mod("week", "published", "draft"), mod("orphan", "published", "nowhere")];
  const lessons = [
    lesson("a", "published", "open"),
    lesson("b", "published", "soon"),
    lesson("c", "draft", "open"),
    lesson("d", "published", "draft"),
    lesson("e", "published", "week"),
    lesson("f", "published", null),
    lesson("g", "published", "unknown-module"),
  ];

  it("gives every module and lesson its state, drafts as hidden", () => {
    const tree = planFullTree(modules, lessons);
    expect(Object.fromEntries(tree.modules)).toEqual({ open: "open", soon: "coming_soon", draft: "hidden", week: "hidden", orphan: "hidden" });
    expect(Object.fromEntries(tree.lessons)).toEqual({ a: "open", b: "coming_soon", c: "hidden", d: "hidden", e: "hidden", f: "open", g: "open" });
  });

  it("keeps a lesson under a module that is not in the list as its own state, like the visible tree", () => {
    expect(planFullTree([], [lesson("g", "published", "unknown-module")]).lessons.get("g")).toBe("open");
  });

  it("is exactly the visible tree plus what was hidden, so the two can never disagree", () => {
    const full = planFullTree(modules, lessons);
    const visible = planVisibleTree(modules, lessons);
    const notHidden = (states: Map<string, string>) => Object.fromEntries([...states].filter(([, state]) => state !== "hidden"));
    expect(Object.fromEntries(visible.lessons)).toEqual(notHidden(full.lessons));
    expect(Object.fromEntries(visible.modules)).toEqual(notHidden(full.modules));
  });
});

describe("slugifyTitle", () => {
  it("makes a URL slug from a Kajabi title", () => {
    expect(slugifyTitle("The Ready Writer")).toBe("the-ready-writer");
    expect(slugifyTitle("  Self-Editing Academy! ")).toBe("self-editing-academy");
    expect(slugifyTitle("Café & Cup")).toBe("cafe-and-cup");
    expect(slugifyTitle("!!!")).toBe("");
  });
});

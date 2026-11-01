import { describe, expect, it } from "vitest";
import { buildHubOutline, moduleContents, moveBefore, moveBy, type HubLessonRow, type HubModuleRow } from "@/lib/courses/hub-outline";

const mod = (id: string, position: number, parent_id: string | null = null, over: Partial<HubModuleRow> = {}): HubModuleRow => ({ id, parent_id, title: id, position, publishing_option: "inherit", ...over });
const les = (id: string, position: number, module_id: string | null, over: Partial<HubLessonRow> = {}): HubLessonRow => ({
  id,
  module_id,
  title: id,
  position,
  publishing_option: "inherit",
  hasText: false,
  hasVideo: false,
  ...over,
});

describe("buildHubOutline", () => {
  const outline = buildHubOutline(
    [mod("m2", 2), mod("m1", 1), mod("w2", 2, "m1"), mod("w1", 1, "m1")],
    [les("l3", 2, "w1"), les("l1", 1, "w1", { hasText: true }), les("l2", 1, "m2", { hasVideo: true }), les("loose", 1, null)]
  );

  it("orders modules, submodules and lessons by position, with submodules inside their module", () => {
    expect(outline.modules.map((m) => m.kajabiId)).toEqual(["m1", "m2"]);
    expect(outline.modules[0].children.map((c) => c.kajabiId)).toEqual(["w1", "w2"]);
    expect(outline.modules[0].children[0].lessons.map((l) => l.kajabiId)).toEqual(["l1", "l3"]);
    expect(outline.modules[1].lessons.map((l) => l.kajabiId)).toEqual(["l2"]);
    expect(outline.loose.map((l) => l.kajabiId)).toEqual(["loose"]);
  });

  it("breaks a tie in position by title, so the order doesn't jump", () => {
    const tied = buildHubOutline([], [les("b", 1, null, { title: "Same" }), les("a", 1, null, { title: "Alpha" })]);
    expect(tied.loose.map((l) => l.kajabiId)).toEqual(["a", "b"]);
  });

  it("says what is in each lesson, by its id", () => {
    expect(outline.content).toEqual({
      l3: { hasText: false, hasVideo: false },
      l1: { hasText: true, hasVideo: false },
      l2: { hasText: false, hasVideo: true },
      loose: { hasText: false, hasVideo: false },
    });
  });

  it("reads each item's state and reason the way an imported course's are read: from its own setting and what is above it", () => {
    const built = buildHubOutline(
      [mod("a", 1), mod("b", 2, null, { publishing_option: "locked" }), mod("c", 3, null, { publishing_option: "draft" })],
      [les("x", 1, "a"), les("y", 1, "b"), les("z", 1, "c", { publishing_option: "published" })]
    );
    expect(built.modules.map((m) => [m.publishingOption, m.state, m.reason])).toEqual([
      ["inherit", "open", "Follows the course"],
      ["locked", "coming_soon", "Locked in the Hub"],
      ["draft", "hidden", "Draft in the Hub"],
    ]);
    expect(built.modules[0].lessons[0]).toMatchObject({ state: "open", reason: "Follows “a”" });
    expect(built.modules[1].lessons[0]).toMatchObject({ state: "coming_soon", reason: "Follows “b”: coming soon" });
    // Its own published setting can't open what a draft module holds.
    expect(built.modules[2].lessons[0]).toMatchObject({ state: "hidden", reason: "Inside “c” (Draft)" });
  });

  it("treats an unknown setting as hidden, never as visible", () => {
    expect(buildHubOutline([mod("a", 1, null, { publishing_option: "weird" })], []).modules[0]).toMatchObject({ state: "hidden" });
  });

  it("shows a lesson whose module is missing as loose, and a module whose parent is missing at the top, instead of dropping them", () => {
    const odd = buildHubOutline([mod("m", 1, "gone")], [les("l", 1, "gone")]);
    expect(odd.modules.map((m) => m.kajabiId)).toEqual(["m"]);
    expect(odd.loose.map((l) => l.kajabiId)).toEqual(["l"]);
  });

  it("is empty for an empty course", () => {
    expect(buildHubOutline([], [])).toEqual({ loose: [], modules: [], content: {} });
  });

  it("can't loop on modules that name each other as parents", () => {
    const loop = buildHubOutline([mod("a", 1, "b"), mod("b", 2, "a"), mod("root", 3)], []);
    expect(loop.modules.map((m) => m.kajabiId)).toEqual(["root"]);
  });
});

describe("moveBefore", () => {
  it("moves an item to where the one it was dropped on is, in either direction", () => {
    expect(moveBefore(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveBefore(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  it("changes nothing when dropped on itself or when either id isn't in the list", () => {
    const ids = ["a", "b", "c"];
    expect(moveBefore(ids, "b", "b")).toBe(ids);
    expect(moveBefore(ids, "x", "b")).toBe(ids);
    expect(moveBefore(ids, "b", "x")).toBe(ids);
  });

  it("doesn't change the list it was given", () => {
    const ids = ["a", "b", "c"];
    moveBefore(ids, "c", "a");
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("moveBy", () => {
  it("moves an item one place up or down", () => {
    expect(moveBy(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveBy(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("changes nothing at either end, or for an id that isn't there", () => {
    const ids = ["a", "b", "c"];
    expect(moveBy(ids, "a", -1)).toBe(ids);
    expect(moveBy(ids, "c", 1)).toBe(ids);
    expect(moveBy(ids, "x", 1)).toBe(ids);
  });
});

describe("moduleContents", () => {
  it("counts the lessons in a module and in its submodules, and the submodules", () => {
    const built = buildHubOutline([mod("m", 1), mod("w1", 1, "m"), mod("w2", 2, "m")], [les("a", 1, "m"), les("b", 1, "w1"), les("c", 2, "w1"), les("d", 1, "w2")]);
    expect(moduleContents(built.modules[0])).toEqual({ lessons: 4, submodules: 2 });
    expect(moduleContents(built.modules[0].children[0])).toEqual({ lessons: 2, submodules: 0 });
  });
});

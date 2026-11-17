import { describe, expect, it } from "vitest";
import { moveBefore, moveBy } from "@/lib/reorder";

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

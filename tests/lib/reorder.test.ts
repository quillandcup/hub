import { describe, expect, it, vi } from "vitest";
import { moveBefore, moveToPosition, positionItems, positionsHeading } from "@/lib/reorder";

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

describe("moveToPosition", () => {
  it("moves an item to a 1-based position, in either direction", () => {
    expect(moveToPosition(["a", "b", "c", "d"], "d", 2)).toEqual(["a", "d", "b", "c"]);
    expect(moveToPosition(["a", "b", "c", "d"], "a", 3)).toEqual(["b", "c", "a", "d"]);
    expect(moveToPosition(["a", "b", "c"], "b", 3)).toEqual(["a", "c", "b"]);
    expect(moveToPosition(["a", "b", "c"], "c", 1)).toEqual(["c", "a", "b"]);
  });

  it("clamps the position, and changes nothing for the current place or an id that isn't there", () => {
    const ids = ["a", "b", "c"];
    expect(moveToPosition(ids, "a", 9)).toEqual(["b", "c", "a"]);
    expect(moveToPosition(ids, "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveToPosition(ids, "b", 2)).toBe(ids);
    expect(moveToPosition(ids, "x", 1)).toBe(ids);
  });
});

describe("positionItems", () => {
  it("has one item per place, the current one marked and off", () => {
    const onMoveTo = vi.fn();
    const items = positionItems(3, 1, onMoveTo, "t");
    expect(items.map((i) => i.label)).toEqual(["Move to position 1", "Position 2 (current)", "Move to position 3"]);
    expect(items.map((i) => i.disabled)).toEqual([false, true, false]);
    items[2].onSelect?.();
    expect(onMoveTo).toHaveBeenCalledWith(3);
    expect(positionsHeading(3)).toBe("Move to position (of 3)");
  });
});

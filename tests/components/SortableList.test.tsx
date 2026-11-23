// @vitest-environment jsdom
/**
 * What a screen reader hears while a member reorders with the keyboard: dnd-kit's live region reads these, naming the
 * project or goal (not its id) and its place in the list.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DndContextProps } from "@dnd-kit/core";
import { SCREEN_READER_INSTRUCTIONS, SortableList, announcementsFor } from "@/components/writing/SortableList";

afterEach(cleanup);

const ids = ["p1", "p2", "p3"];
const labels = { p1: "Alpha Draft", p2: "Beta Draft", p3: "Gamma Draft" };
const event = (active: string, over: string | null) => ({ active: { id: active }, over: over ? { id: over } : null }) as never;

describe("announcementsFor", () => {
  const a = announcementsFor(ids, labels);

  it("says what was picked up and where it is", () => {
    expect(a.onDragStart!({ active: { id: "p2" } } as never)).toBe("Picked up Beta Draft. It is at position 2 of 3.");
  });

  it("says where it is while moving, and when it is over nothing", () => {
    expect(a.onDragOver!(event("p1", "p3"))).toBe("Alpha Draft is now over position 3 of 3.");
    expect(a.onDragOver!(event("p1", null))).toBe("Alpha Draft is no longer over a place in the list.");
  });

  it("says where it was dropped, or that it stayed", () => {
    expect(a.onDragEnd!(event("p1", "p3"))).toBe("Alpha Draft was dropped at position 3 of 3.");
    expect(a.onDragEnd!(event("p2", null))).toBe("Beta Draft was dropped where it started, at position 2 of 3.");
  });

  it("says a cancelled move put it back", () => {
    expect(a.onDragCancel!(event("p3", null))).toBe("Reordering cancelled. Gamma Draft is back at position 3 of 3.");
  });

  it("falls back to a plain word for an item it has no name for", () => {
    expect(announcementsFor(ids, {}).onDragStart!({ active: { id: "p1" } } as never)).toBe("Picked up Item. It is at position 1 of 3.");
  });
});

describe("SortableList", () => {
  it("hands dnd-kit the announcements and the keyboard instructions", async () => {
    let captured: DndContextProps | null = null;
    const { vi } = await import("vitest");
    vi.doMock("@dnd-kit/core", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@dnd-kit/core")>();
      return {
        ...actual,
        DndContext: (props: DndContextProps) => {
          captured = props;
          return null;
        },
      };
    });
    vi.resetModules();
    const { SortableList: Fresh } = await import("@/components/writing/SortableList");
    render(<Fresh ids={ids} labels={labels} onReorder={() => {}}>{null}</Fresh>);
    // An id of its own (React's, the same on the server and in the browser): dnd-kit's counter is not, which was a hydration mismatch.
    expect((captured as DndContextProps | null)?.id).toEqual(expect.any(String));
    expect((captured as DndContextProps | null)?.id).not.toBe("");
    const accessibility = (captured as DndContextProps | null)?.accessibility;
    expect(accessibility?.screenReaderInstructions).toEqual(SCREEN_READER_INSTRUCTIONS);
    expect(accessibility?.announcements?.onDragStart?.({ active: { id: "p1" } } as never)).toBe("Picked up Alpha Draft. It is at position 1 of 3.");
    expect(SCREEN_READER_INSTRUCTIONS.draggable).toMatch(/Space.*arrow keys.*Escape/);
    vi.doUnmock("@dnd-kit/core");
    expect(SortableList).toBeTypeOf("function");
  });
});

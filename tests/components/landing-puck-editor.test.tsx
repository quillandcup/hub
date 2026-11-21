// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const proto = (globalThis as unknown as { HTMLElement?: { prototype: Record<string, unknown> } }).HTMLElement?.prototype;
  if (proto) proto.scrollIntoView ??= () => {};
});

import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Puck, createUsePuck, type Data } from "@puckeditor/core";
import { editorConfig } from "@/components/landing/editor-config";
import { ITEM_BLOCKS, SLOT_ALLOW } from "@/components/landing/config";

afterEach(cleanup);

/**
 * The real Puck editor (in jsdom, without its iframe) with the editor config: what a drag on the canvas does to the
 * data is a `move` (or `insert`) action on the slot's zone, so dispatching that is the same change as the drag, and the
 * canvas redraws from it. The pointer-driven drag itself needs a browser.
 */

type Node = { type: string; props: Record<string, unknown> };
const day = (id: string, label: string, text: string): Node => ({ type: "WeekDay", props: { id, label, emoji: "", text, note: "" } });
const data = { content: [{ type: "WeekStrip", props: { id: "w1", subtitle: "A week", items: [day("d1", "Mon", "First"), day("d2", "Tue", "Second")] } }], root: { props: {} } } as unknown as Data;

const usePuck = createUsePuck();
let dispatch: ((action: unknown) => void) | undefined;
let latest: Data | undefined;

function Probe() {
  const puckDispatch = usePuck((s) => s.dispatch) as (action: unknown) => void;
  useEffect(() => {
    dispatch = puckDispatch;
  }, [puckDispatch]);
  return null;
}

function mount(initial: Data = data) {
  latest = undefined;
  return render(<Puck config={editorConfig} data={initial} iframe={{ enabled: false }} onChange={(next) => (latest = next)} overrides={{ header: () => <Probe /> }} />);
}

const labels = (container: HTMLElement) => [...container.querySelectorAll("ol[data-puck-dropzone] > li")].map((li) => li.querySelector("p")?.textContent);
const itemsOf = (parent: Node | undefined) => (parent?.props.items as Node[]).map((i) => i.props.label);

describe("the real Puck editor with an items slot", () => {
  it("draws the items of a block inside it, in order, each as a list item of the block's own list", async () => {
    const { container } = mount();
    expect(await screen.findAllByText("First")).not.toHaveLength(0);
    expect(labels(container)).toEqual(["Mon", "Tue"]);
    expect(container.querySelector("ol[data-puck-dropzone]")!.getAttribute("data-puck-dropzone")).toBe("w1:items");
  });

  it("reorders the items when one is moved within the slot, as dragging one does, and the canvas follows", async () => {
    const { container } = mount();
    await screen.findAllByText("First");
    act(() => dispatch!({ type: "move", sourceZone: "w1:items", sourceIndex: 0, destinationZone: "w1:items", destinationIndex: 1 }));
    await waitFor(() => expect(labels(container)).toEqual(["Tue", "Mon"]));
    expect(itemsOf(latest?.content[0] as unknown as Node)).toEqual(["Tue", "Mon"]);
  });

  it("adds an item to the slot with the type's defaults, and gives a block added to the page its starting items ids", async () => {
    const { container } = mount();
    await screen.findAllByText("First");
    act(() => dispatch!({ type: "insert", componentType: "WeekDay", destinationZone: "w1:items", destinationIndex: 2 }));
    await waitFor(() => expect(labels(container)).toEqual(["Mon", "Tue", "Day"]));
    act(() => dispatch!({ type: "insert", componentType: "Steps", destinationZone: "root:default-zone", destinationIndex: 1 }));
    await waitFor(() => expect((latest!.content as unknown as Node[]).some((c) => c.type === "Steps")).toBe(true));
    const steps = (latest!.content as unknown as Node[]).find((c) => c.type === "Steps")!;
    const kids = steps.props.items as Node[];
    expect(kids.map((k) => k.type)).toEqual(["Step", "Step", "Step"]);
    expect(new Set(kids.map((k) => k.props.id)).size).toBe(3);
    expect(kids.every((k) => typeof k.props.id === "string" && (k.props.id as string).startsWith("Step-"))).toBe(true);
  });

  it("limits each list to its own item type, and keeps the items out of sections and columns", () => {
    for (const [parent, slots] of Object.entries(SLOT_ALLOW)) {
      expect(editorConfig.components[parent].fields?.items, parent).toMatchObject({ type: "slot", allow: slots!.items });
    }
    expect(ITEM_BLOCKS.length).toBeGreaterThan(0);
    for (const name of ["Section", "Columns"]) {
      for (const field of Object.values(editorConfig.components[name].fields ?? {})) {
        if (field.type === "slot") expect(field.disallow, name).toEqual(ITEM_BLOCKS);
      }
    }
  });
});

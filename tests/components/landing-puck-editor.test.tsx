// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";

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
import { normalizeLandingData } from "@/lib/landing/data";

// Puck starts a 500 ms timer when the editor mounts (it shows its loader after that). A test that ends sooner leaves it pending, and it
// fires after the file's jsdom is gone ("window is not defined", an unhandled error that fails the run), so the timers it starts are
// cleared when the editor is unmounted. Nothing here depends on them.
const loaderTimers = new Set<unknown>();
const realSetTimeout = globalThis.setTimeout;
beforeAll(() => {
  globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    const timer = realSetTimeout(handler as () => void, ms, ...args);
    if (ms === 500) loaderTimers.add(timer);
    return timer;
  }) as typeof setTimeout;
});
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
});
afterEach(() => {
  cleanup();
  for (const timer of loaderTimers) clearTimeout(timer as never);
  loaderTimers.clear();
});

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

  it.each([
    ["List", "ListItem", "ul", (id: string, text: string) => ({ id, text, icon: "✓" }), "text"],
    ["Accordion", "AccordionItem", "div", (id: string, title: string) => ({ id, title, text: "", open: false }), "title"],
    ["Faq", "FaqQuestion", "div", (id: string, question: string) => ({ id, question, answer: "" }), "question"],
    ["ButtonRow", "RowButton", "ul", (id: string, label: string) => ({ id, label, href: "", look: "solid", color: "plum", shape: "pill" }), "label"],
    ["OutcomeNumbers", "OutcomeNumber", "dl", (id: string, label: string) => ({ id, source: "manual", stat: "hours_30d", value: "1", label, note: "" }), "label"],
  ] as const)("reorders the items of a %s as dragging one does, and the canvas follows", async (parent, itemType, _tag, props, key) => {
    const list: Node[] = [{ type: itemType, props: props("a1", "Alpha") }, { type: itemType, props: props("a2", "Beta") }];
    const { container } = mount({ content: [{ type: parent, props: { id: "p1", items: list } }], root: { props: {} } } as unknown as Data);
    await screen.findAllByText("Alpha");
    const zone = container.querySelector('[data-puck-dropzone="p1:items"]')!;
    expect(zone).not.toBeNull();
    const order = () => [...container.querySelectorAll('[data-puck-dropzone="p1:items"] > *')].map((el) => ["Alpha", "Beta"].find((name) => el.textContent?.includes(name)));
    await waitFor(() => expect(order()).toEqual(["Alpha", "Beta"]));
    act(() => dispatch!({ type: "move", sourceZone: "p1:items", sourceIndex: 1, destinationZone: "p1:items", destinationIndex: 0 }));
    await waitFor(() => expect(order()).toEqual(["Beta", "Alpha"]));
    expect(((latest?.content[0] as unknown as Node).props.items as Node[]).map((i) => i.props[key])).toEqual(["Beta", "Alpha"]);
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

describe("a page saved before items became child blocks", () => {
  // Saved with the items as plain lists (what every page made before #1600 holds). The editor page loads a stored document through
  // `normalizeLandingData`; Puck itself throws "Cannot read properties of undefined (reading 'id')" on a list item that is not a block.
  const legacy = {
    content: [
      { type: "WeekStrip", props: { id: "w1", subtitle: "A week", items: [{ label: "Mon", emoji: "", text: "First", note: "" }, { label: "Tue", emoji: "", text: "Second", note: "" }] } },
      { type: "Section", props: { id: "s1", content: [{ type: "Steps", props: { id: "st1", heading: "How", items: [{ title: "One", text: "a" }, { title: "Two", text: "b" }] } }] } },
    ],
    root: { props: {} },
  };

  it("opens in the real editor after loading, with its items in order as blocks of their own", async () => {
    const { container } = mount(normalizeLandingData(legacy) as unknown as Data);
    expect(await screen.findAllByText("First")).not.toHaveLength(0);
    expect(labels(container)[0]).toBe("Mon");
    expect(labels(container)).toContain("Tue");
  });

  it("opens a page saved with plain lists for Buttons, the Schedule panel's rows and Outcome numbers, too", async () => {
    const older = {
      content: [
        { type: "ButtonRow", props: { id: "b1", align: "left", gap: "medium", items: [{ label: "Join us", href: "/join", look: "solid", color: "plum", shape: "pill" }] } },
        { type: "SchedulePanel", props: { id: "sp1", title: "Today", source: "manual", rows: [{ time: "9:00 am", title: "Morning pages", status: "", state: "open", host: "" }] } },
        { type: "OutcomeNumbers", props: { id: "o1", items: [{ source: "manual", value: "50+", label: "books", note: "" }] } },
      ],
      root: { props: {} },
    };
    mount(normalizeLandingData(older) as unknown as Data);
    expect((await screen.findAllByText("Join us")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Morning pages").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50+").length).toBeGreaterThan(0);
  });
});

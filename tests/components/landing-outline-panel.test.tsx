// @vitest-environment jsdom
/** The editor's left panel drill-down: page, then a section's blocks, then a block's fields; Back; what Add offers where; reordering. */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), store: {} as Record<string, unknown>, dnd: null as null | { onDragEnd?: (e: unknown) => void } }));

vi.mock("@puckeditor/core", () => ({
  Drawer: Object.assign(({ children }: { children: ReactNode }) => <div data-testid="drawer">{children}</div>, { Item: () => null }),
  Puck: { Fields: () => <div data-testid="fields">the fields</div> },
  createUsePuck: () => (select: (state: unknown) => unknown) => select({ dispatch: mocks.dispatch, ...mocks.store }),
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      mocks.dnd = props as never;
      return <actual.DndContext {...props} />;
    },
  };
});

import { OutlinePanel, outlinePlugin } from "@/app/(admin)/admin/pages/[slug]/OutlinePanel";
import { DESIGN_HREF } from "@/components/landing/config";

type Item = { type: string; props: Record<string, unknown> & { id: string } };
const heading = (id: string, text: string): Item => ({ type: "Heading", props: { id, text } });
const button = (id: string, label: string): Item => ({ type: "Button", props: { id, label } });
const step = (id: string, title: string): Item => ({ type: "Step", props: { id, title } });

const config = {
  components: {
    Section: { label: "Section", fields: { background: { type: "select" }, content: { type: "slot", disallow: ["Step"] } } },
    Columns: { fields: { col1: { type: "slot", disallow: ["Step"] }, col2: { type: "slot", disallow: ["Step"] } } },
    Steps: { fields: { heading: { type: "text" }, items: { type: "slot", label: "Steps (2 to 5)", allow: ["Step"] } } },
    Step: { fields: { title: { type: "text" } } },
    Heading: { label: "Title", fields: { text: { type: "text" } } },
    Button: { fields: { label: { type: "text" } } },
  },
  categories: {
    layout: { title: "Layout", components: ["Section", "Columns", "Steps"] },
    content: { title: "Content", components: ["Heading", "Button"] },
    parts: { title: "Parts of a block", components: ["Step"] },
  },
};

const section = (id: string, content: Item[]): Item => ({ type: "Section", props: { id, content } });
const page = () => ({
  content: [
    section("s1", [heading("h1", "Welcome home"), button("b1", "Join us")]),
    section("s2", []),
    { type: "Steps", props: { id: "st", heading: "How it works", items: [step("a", "Sign up"), step("b", "Join in"), step("c", "Keep going")] } },
    { type: "Columns", props: { id: "c1", col1: [heading("h2", "Left")], col2: [] } },
  ] as Item[],
  root: { props: {} },
});

/** A tiny stand-in for Puck's store, derived from the page data. */
function setStore(opts: { selected?: string | null; pinned?: boolean } = {}) {
  const data = page();
  const all = new Map<string, { item: Item; parent?: Item; zone: string; index: number }>();
  const walk = (list: Item[], zone: string, parent?: Item) =>
    list.forEach((item, index) => {
      all.set(item.props.id, { item, parent, zone, index });
      for (const key of ["content", "items", "col1", "col2"]) if (Array.isArray(item.props[key])) walk(item.props[key] as Item[], `${item.props.id}:${key}`, item);
    });
  walk(data.content, "root:default-zone");
  const selected = opts.selected ? all.get(opts.selected)!.item : null;
  mocks.store = {
    config,
    selectedItem: selected,
    appState: { data, ui: { rightSideBarVisible: opts.pinned ?? false } },
    getParentById: (id: string) => all.get(id)?.parent,
    getSelectorForId: (id: string) => (all.has(id) ? { index: all.get(id)!.index, zone: all.get(id)!.zone } : undefined),
  };
}

const panel = (pageType: "website" | "landing" = "landing") => render(<OutlinePanel pageType={pageType} hiddenAtRoot={["Step"]} />);
const select = (id: string | null, index = 0, zone = "root:default-zone") => ({ type: "setUi", ui: { itemSelector: id ? { index, zone } : null } });

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.dispatch.mockReset();
  mocks.store = {};
  mocks.dnd = null;
});

describe("page level", () => {
  it("lists the sections in order, with Add section, and the header and footer", () => {
    setStore();
    panel();
    expect(screen.getByRole("heading", { name: "Page" })).toBeInTheDocument();
    const sections = screen.getByRole("region", { name: "Sections" });
    expect(within(sections).getAllByRole("button", { name: /^(Section|Steps|Columns)/ }).map((b) => b.textContent)).toEqual(["Section", "Section", "StepsHow it works", "Columns"]);
    expect(screen.getByRole("button", { name: "Add section" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Header" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Footer" })).toBeInTheDocument();
  });

  it("clicking a section selects it on the canvas, which is what takes the panel down a level", () => {
    setStore();
    panel();
    fireEvent.click(within(screen.getByRole("region", { name: "Sections" })).getByRole("button", { name: /^Steps/ }));
    expect(mocks.dispatch).toHaveBeenCalledWith(select("st", 2));
  });

  it("a website page's header and footer are links to Design, not editable here", () => {
    setStore();
    panel("website");
    for (const name of ["Header", "Footer"]) {
      const link = screen.getByRole("link", { name: new RegExp(name) });
      expect(link).toHaveAttribute("href", DESIGN_HREF);
    }
    expect(screen.queryByRole("button", { name: "Header" })).toBeNull();
  });

  it("a landing page's header and footer open its own fields, and Back returns to the page", () => {
    setStore();
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Header" }));
    expect(screen.getByRole("heading", { name: "Header and footer" })).toBeInTheDocument();
    expect(screen.getByTestId("fields")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to the page" }));
    expect(screen.getByRole("heading", { name: "Page" })).toBeInTheDocument();
  });

  it("Add section shows the Add list without the parts of other blocks, and picking one adds it at the end and selects it", () => {
    setStore();
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByRole("heading", { name: "Add section" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search blocks")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search blocks"), { target: { value: "step" } });
    // "Step" is a part of Steps and never a section; "Steps" is.
    expect(screen.getAllByRole("button", { name: /Steps|Step$/ }).map((b) => b.textContent)).toEqual(["Steps"]);
    fireEvent.change(screen.getByLabelText("Search blocks"), { target: { value: "title" } });
    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, { type: "insert", componentType: "Heading", destinationIndex: 4, destinationZone: "root:default-zone", id: "Heading-00000000-0000-4000-8000-000000000000", recordHistory: true });
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, select("x", 4));
  });

  it("Back in the Add list returns to the page without adding", () => {
    setStore();
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(screen.getByRole("heading", { name: "Page" })).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe("section level", () => {
  it("shows the section's blocks, Add block, and its own settings (the fields) under them", () => {
    setStore({ selected: "s1" });
    panel();
    expect(screen.getByRole("heading", { name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^TitleWelcome home/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ButtonJoin us/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add block" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByTestId("fields")).toBeInTheDocument();
  });

  it("Back goes up to the page; clicking a block selects it", () => {
    setStore({ selected: "s1" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Back to the page" }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith(select(null));
    fireEvent.click(screen.getByRole("button", { name: /^ButtonJoin us/ }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith(select("b1", 1, "s1:content"));
  });

  it("an empty section says so and can still add a block, which goes into its zone", () => {
    setStore({ selected: "s2" });
    panel();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    expect(screen.getByRole("heading", { name: "Add block" })).toBeInTheDocument();
    // The slot refuses a lone Step, so it is not offered.
    fireEvent.change(screen.getByLabelText("Search blocks"), { target: { value: "step" } });
    expect(screen.getAllByRole("button", { name: /Steps/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Steps" }));
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "insert", componentType: "Steps", destinationZone: "s2:content", destinationIndex: 0 }));
  });

  it("a block that takes one kind of part adds it straight away, named for it", () => {
    setStore({ selected: "st" });
    panel();
    expect(screen.queryByLabelText("Search blocks")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "insert", componentType: "Step", destinationZone: "st:items", destinationIndex: 3 }));
  });

  it("lists slot children such as a block's items", () => {
    setStore({ selected: "st" });
    panel();
    expect(screen.getAllByRole("button", { name: /^Step(Sign up|Join in|Keep going)$/ })).toHaveLength(3);
  });

  it("columns show a list and an Add button per column", () => {
    setStore({ selected: "c1" });
    panel();
    expect(screen.getByRole("region", { name: "Column 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Column 2" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add block" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Add block" })[1]);
    expect(screen.getByRole("heading", { name: "Add block to column 2" })).toBeInTheDocument();
  });
});

describe("block level", () => {
  it("shows the block's fields in the left panel under Back to its section", () => {
    setStore({ selected: "h1" });
    panel();
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByTestId("fields")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Section" }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith(select("s1", 0));
  });

  it("a top level block goes Back to the page", () => {
    setStore({ selected: "st" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Back to the page" }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith(select(null));
  });

  it("with the fields pinned to the right panel it points there instead of showing them twice", () => {
    setStore({ selected: "h1", pinned: true });
    panel();
    expect(screen.queryByTestId("fields")).toBeNull();
    expect(screen.getByText(/The fields are in the panel on the right/)).toBeInTheDocument();
  });
});

describe("reordering", () => {
  it("a drag of a section down a place reorders it in the page's zone", () => {
    setStore();
    panel();
    mocks.dnd!.onDragEnd!({ active: { id: "s1" }, over: { id: "s2" } });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "reorder", sourceIndex: 0, destinationIndex: 1, destinationZone: "root:default-zone", recordHistory: true });
  });

  it("a drag inside a block's list reorders in that slot's zone", () => {
    setStore({ selected: "st" });
    panel();
    mocks.dnd!.onDragEnd!({ active: { id: "c" }, over: { id: "a" } });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "reorder", sourceIndex: 2, destinationIndex: 0, destinationZone: "st:items", recordHistory: true });
  });

  it("a drop where it started does nothing", () => {
    setStore();
    panel();
    mocks.dnd!.onDragEnd!({ active: { id: "s1" }, over: { id: "s1" } });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("the Move to position menu is the keyboard and no-drag way", () => {
    setStore({ selected: "st" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: /More actions for Step Sign up/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to position 3" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "reorder", sourceIndex: 0, destinationIndex: 2, destinationZone: "st:items", recordHistory: true });
  });

  it("every row has a keyboard handle, and a lone block has no ordering controls", () => {
    setStore({ selected: "s1" });
    panel();
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(2);
    cleanup();
    setStore({ selected: "c1" });
    panel();
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
  });
});

describe("the plugin", () => {
  it("replaces Puck's own outline and renders the panel", () => {
    setStore();
    const plugin = outlinePlugin("landing", ["Step"]);
    expect(plugin.name).toBe("outline");
    render(plugin.render());
    expect(screen.getByRole("heading", { name: "Page" })).toBeInTheDocument();
  });
});

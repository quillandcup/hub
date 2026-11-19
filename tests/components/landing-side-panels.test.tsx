// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), store: {} as Record<string, unknown> }));

vi.mock("@puckeditor/core", () => ({
  Drawer: Object.assign(({ children }: { children: ReactNode }) => <div data-testid="drawer">{children}</div>, {
    Item: ({ name, label }: { name: string; label?: string }) => <div data-testid="drag-item" data-name={name}>{label ?? name}</div>,
  }),
  createUsePuck: () => (select: (state: unknown) => unknown) => select({ dispatch: mocks.dispatch, ...mocks.store }),
}));

import { AddListView, BreadcrumbView, OpenFieldsOnSelect, addGroups, addPlugin, filterGroups, panelOverrides } from "@/app/(admin)/admin/pages/[slug]/SidePanels";

afterEach(() => {
  cleanup();
  mocks.dispatch.mockReset();
  mocks.store = {};
});

const config = {
  components: { Section: {}, Heading: { label: "Title" }, Button: {}, Faq: {}, Orphan: {} },
  categories: {
    layout: { title: "Layout", components: ["Section", "Missing"] },
    content: { title: "Content", components: ["Heading", "Faq"] },
    links: { title: "Links", components: ["Button"] },
  },
} as never;

describe("addGroups and filterGroups", () => {
  it("follows the categories in order, drops unknown blocks and puts leftovers under Other", () => {
    const groups = addGroups(config);
    expect(groups.map((g) => g.title)).toEqual(["Layout", "Content", "Links", "Other"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["Section"]);
    expect(groups[1].items[0]).toEqual({ name: "Heading", label: "Title" });
    expect(groups[3].items.map((i) => i.name)).toEqual(["Orphan"]);
  });

  it("has no Other group when every block is categorised, and works without categories", () => {
    expect(addGroups({ components: { A: {} } } as never).map((g) => g.title)).toEqual(["Other"]);
    expect(addGroups({ components: { A: {} }, categories: { x: { components: ["A"] } } } as never).map((g) => g.title)).toEqual(["x"]);
  });

  it("matches every typed word against label, name and category, and drops empty groups", () => {
    const groups = addGroups(config);
    expect(filterGroups(groups, "  ")).toBe(groups);
    expect(filterGroups(groups, "title").map((g) => g.items.map((i) => i.name))).toEqual([["Heading"]]);
    expect(filterGroups(groups, "heading").map((g) => g.title)).toEqual(["Content"]);
    expect(filterGroups(groups, "links button").map((g) => g.title)).toEqual(["Links"]);
    expect(filterGroups(groups, "zzz")).toEqual([]);
  });
});

describe("AddListView", () => {
  const view = () => render(<AddListView groups={addGroups(config)} renderItem={(i) => <span data-testid="item">{i.label}</span>} />);
  const header = (name: RegExp) => screen.getByRole("button", { name });

  it("opens only the first category", () => {
    view();
    expect(header(/Layout/)).toHaveAttribute("aria-expanded", "true");
    expect(header(/Content/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("item").map((e) => e.textContent)).toEqual(["Section"]);
  });

  it("opens and closes a category on click", () => {
    view();
    fireEvent.click(header(/Content/));
    expect(screen.getAllByTestId("item").map((e) => e.textContent)).toEqual(["Section", "Title", "Faq"]);
    fireEvent.click(header(/Layout/));
    expect(screen.getAllByTestId("item").map((e) => e.textContent)).toEqual(["Title", "Faq"]);
  });

  it("searches across collapsed categories, then goes back to the collapsed state", () => {
    view();
    const box = screen.getByLabelText("Search blocks");
    fireEvent.change(box, { target: { value: "faq" } });
    expect(screen.getAllByTestId("item").map((e) => e.textContent)).toEqual(["Faq"]);
    expect(header(/Content/)).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getAllByTestId("item").map((e) => e.textContent)).toEqual(["Section"]);
  });

  it("says when nothing matches", () => {
    view();
    fireEvent.change(screen.getByLabelText("Search blocks"), { target: { value: "nope" } });
    expect(screen.getByText(/No block matches/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("item")).toEqual([]);
  });

  it("the plugin keeps Puck's name so it replaces the Blocks tab, and renders draggable items", () => {
    expect(addPlugin.name).toBe("blocks");
    mocks.store = { config };
    render(addPlugin.render());
    expect(screen.getByTestId("drag-item")).toHaveAttribute("data-name", "Section");
  });
});

describe("BreadcrumbView", () => {
  it("shows nothing when nothing is selected", () => {
    const { container } = render(<BreadcrumbView crumbs={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Back from a block goes to its section, from a section to the page", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <BreadcrumbView crumbs={[{ id: "s", label: "Section" }, { id: "h", label: "Heading" }]} onSelect={onSelect} />,
    );
    expect(screen.getByText("Heading")).toHaveAttribute("aria-current", "location");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onSelect).toHaveBeenLastCalledWith("s");
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    rerender(<BreadcrumbView crumbs={[{ id: "s", label: "Section" }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("an ancestor in the path is a button that selects it", () => {
    const onSelect = vi.fn();
    render(<BreadcrumbView crumbs={[{ id: "s", label: "Section" }, { id: "c", label: "Columns" }, { id: "h", label: "Heading" }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Section" }));
    expect(onSelect).toHaveBeenLastCalledWith("s");
  });
});

describe("panel overrides", () => {
  const item = (id: string, type: string) => ({ type, props: { id } });

  it("the settings panel shows the path of the selection above the fields, and Back selects the parent", () => {
    const parent = item("s", "Section");
    mocks.store = {
      config: { components: { Section: {}, Heading: {} } },
      selectedItem: item("h", "Heading"),
      getParentById: (id: string) => (id === "h" ? parent : undefined),
      getSelectorForId: (id: string) => ({ index: 0, zone: `${id}:content` }),
    };
    render(panelOverrides.fields({ children: <p>the fields</p> }));
    expect(screen.getByText("the fields")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { itemSelector: { index: 0, zone: "s:content" } } });
  });

  it("has no path when nothing is selected", () => {
    mocks.store = { config: { components: {} }, selectedItem: null };
    render(panelOverrides.fields({ children: <p>page fields</p> }));
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("Back from a top level block clears the selection", () => {
    mocks.store = { config: { components: {} }, selectedItem: item("s", "Section"), getParentById: () => undefined, getSelectorForId: vi.fn() };
    render(panelOverrides.fields({ children: null }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { itemSelector: null } });
  });

  it("opens the settings panel when something is selected and it is closed, not when it is open or nothing is selected", () => {
    mocks.store = { selectedItem: item("h", "Heading"), appState: { ui: { rightSideBarVisible: false } } };
    const { unmount } = render(<OpenFieldsOnSelect />);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { rightSideBarVisible: true } });
    unmount();
    mocks.dispatch.mockReset();
    mocks.store = { selectedItem: item("h", "Heading"), appState: { ui: { rightSideBarVisible: true } } };
    render(<OpenFieldsOnSelect />).unmount();
    mocks.store = { selectedItem: null, appState: { ui: { rightSideBarVisible: false } } };
    render(<OpenFieldsOnSelect />);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("the puck override renders the opener and the editor", () => {
    mocks.store = { selectedItem: null, appState: { ui: { rightSideBarVisible: false } } };
    render(panelOverrides.puck({ children: <p>editor</p> }));
    expect(screen.getByText("editor")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
/**
 * A member puts their active projects in their own order: a grip on each card (drag it, or Space and the arrow keys) and
 * Move up / Move down buttons for anyone who can't drag. jsdom has no layout or real touch, so the drag itself is driven
 * through the `onDragEnd` the list hands to dnd-kit, and the buttons are clicked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DndContextProps } from "@dnd-kit/core";
import { HANDLE_TOOLTIP } from "@/components/writing/SortableList";
import ProjectsClient from "@/app/(member)/projects/ProjectsClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";
import { tooltipText } from "@/tests/helpers/tooltip";

const m = vi.hoisted(() => ({ refresh: vi.fn(), reorder: vi.fn(), dnd: { current: null as null | DndContextProps } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: m.refresh }) }));
vi.mock("@/app/(member)/projects/actions", () => ({ reorderMyProjects: m.reorder }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      m.dnd.current = props;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock("@/components/writing/NewProjectModal", () => ({ default: () => null }));
vi.mock("@/components/writing/TrackbearImportModal", () => ({ default: () => null }));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));
vi.mock("@/app/(member)/projects/PastProjects", () => ({ default: () => null }));

const project = (id: string, title: string) =>
  ({ id, title, phase: "drafting", createdAt: "2026-01-01T00:00:00Z", showOnProfile: false, visibility: "private", coverUrl: null, description: null, startingBalances: {}, totalsByMeasure: {}, goals: [], book: null }) as unknown as WritingProjectRow;

const projects = () => [project("wprj_a", "Alpha Draft"), project("wprj_b", "Beta Draft"), project("wprj_c", "Gamma Draft")];

const titles = () => [...document.querySelectorAll("[data-sortable-row]")].map((card) => within(card as HTMLElement).getByRole("link").textContent);

beforeEach(() => {
  m.refresh.mockReset();
  m.reorder.mockReset().mockResolvedValue({ success: true });
});
afterEach(cleanup);

describe("ProjectsClient reordering", () => {
  async function openMenu(title: string) {
    await userEvent.click(screen.getByRole("button", { name: `More actions for ${title}` }));
  }

  it("lists the projects in the order it is given, each with a drag handle that explains itself", () => {
    render(<ProjectsClient initialProjects={projects()} />);
    expect(titles()).toEqual(["Alpha Draft", "Beta Draft", "Gamma Draft"]);
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(3);
    // The position menu has its own reorder icon (an svg, no three dots) and a tooltip equal to its name.
    const trigger = screen.getByRole("button", { name: "More actions for Beta Draft" });
    expect(trigger).toHaveTextContent("");
    expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(tooltipText(trigger)).toBe("More actions for Beta Draft");
    expect(screen.getByRole("button", { name: /^Reorder Beta Draft/ })).toHaveAttribute("aria-roledescription", "sortable");
    // Not only an aria-label: a tooltip that shows on hover and keyboard focus, with the keyboard steps.
    for (const handle of screen.getAllByRole("button", { name: /^Reorder / })) expect(tooltipText(handle)).toBe(HANDLE_TOOLTIP);
    expect(HANDLE_TOOLTIP).toBe("Drag to reorder. Keyboard: press Space to pick up, arrow keys to move, Space to drop.");
    // The tip is the shared Tooltip (hover only where there is a hover, focus-visible, Escape: tests/components/Tooltip.test.tsx).
    const handle = screen.getAllByRole("button", { name: /^Reorder / })[0];
    expect(tooltipText(handle)).toBe(HANDLE_TOOLTIP);
  });

  it("gives every handle the shared two-bar grip icon, small and unboxed", () => {
    render(<ProjectsClient initialProjects={projects()} />);
    for (const handle of screen.getAllByRole("button", { name: /^Reorder / })) {
      expect(handle.querySelector("svg.lucide-equal")).not.toBeNull();
      expect(handle.querySelector("svg.lucide-grip-vertical")).toBeNull();
      expect(handle.querySelector("svg")!.getAttribute("class")).toMatch(/\bh-5 w-5\b/);
      expect(handle.className).toMatch(/touch-none/);
      expect(handle.className).not.toMatch(/(^|\s)(dark:)?bg-|h-11|w-11/);
    }
  });

  it("has no Move up / Move down buttons any more", () => {
    render(<ProjectsClient initialProjects={projects()} />);
    expect(screen.queryByRole("button", { name: /^Move .* (up|down)$/ })).toBeNull();
  });

  it("has no ordering controls for a single project", () => {
    render(<ProjectsClient initialProjects={[project("wprj_a", "Alpha Draft")]} />);
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^More actions for / })).toBeNull();
  });

  it("offers every position in the menu, with the current one marked and not choosable", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    await openMenu("Beta Draft");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Move to position 1", "Position 2 (current)", "Move to position 3"]);
    expect(screen.getByRole("menuitem", { name: "Position 2 (current)" })).toHaveAttribute("aria-disabled", "true");
  });

  it("moves a project to the chosen position in one step, shows it at once, saves the whole order, refreshes and announces it", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    await openMenu("Alpha Draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 3" }));
    expect(titles()).toEqual(["Beta Draft", "Gamma Draft", "Alpha Draft"]);
    expect(m.reorder).toHaveBeenCalledWith(["wprj_b", "wprj_c", "wprj_a"]);
    await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("Alpha Draft moved to position 3 of 3.")).toBeInTheDocument();
  });

  it("moves a project up to the first position", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    await openMenu("Gamma Draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 1" }));
    expect(m.reorder).toHaveBeenCalledWith(["wprj_c", "wprj_a", "wprj_b"]);
  });

  it("works from the keyboard: open the menu, arrow to a position, Enter", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    screen.getByRole("button", { name: "More actions for Alpha Draft" }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(m.reorder).toHaveBeenCalledWith(["wprj_b", "wprj_c", "wprj_a"]);
  });

  it("saves the order a drag ended in, and ignores a drop where it started or outside the list", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    const end = m.dnd.current!.onDragEnd!;
    const drop = (active: string, over: string | null) => end({ active: { id: active }, over: over ? { id: over } : null } as never);

    drop("wprj_a", "wprj_a");
    drop("wprj_a", null);
    drop("wprj_a", "nope");
    expect(m.reorder).not.toHaveBeenCalled();

    drop("wprj_c", "wprj_a");
    await waitFor(() => expect(m.reorder).toHaveBeenCalledWith(["wprj_c", "wprj_a", "wprj_b"]));
    await waitFor(() => expect(titles()).toEqual(["Gamma Draft", "Alpha Draft", "Beta Draft"]));
  });

  it("puts the list back and says so when the save is refused", async () => {
    m.reorder.mockResolvedValue({ error: "Failed to save the order" });
    render(<ProjectsClient initialProjects={projects()} />);
    await openMenu("Alpha Draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the new order");
    expect(titles()).toEqual(["Alpha Draft", "Beta Draft", "Gamma Draft"]);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("puts the list back when the request itself fails", async () => {
    m.reorder.mockRejectedValue(new Error("network"));
    render(<ProjectsClient initialProjects={projects()} />);
    await openMenu("Beta Draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 1" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(titles()).toEqual(["Alpha Draft", "Beta Draft", "Gamma Draft"]);
  });

  it("follows the page's list once it brings a new one", async () => {
    const { rerender } = render(<ProjectsClient initialProjects={projects()} />);
    await openMenu("Alpha Draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 2" }));
    const [a, b, c] = projects();
    rerender(<ProjectsClient initialProjects={[b, a, c]} />);
    expect(titles()).toEqual(["Beta Draft", "Alpha Draft", "Gamma Draft"]);
    rerender(<ProjectsClient initialProjects={[c, b, a]} />);
    expect(titles()).toEqual(["Gamma Draft", "Beta Draft", "Alpha Draft"]);
  });
});

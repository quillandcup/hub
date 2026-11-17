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
import ProjectsClient from "@/app/(member)/projects/ProjectsClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";

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
  ({ id, title, phase: "drafting", createdAt: "2026-01-01T00:00:00Z", showOnProfile: false, coverUrl: null, description: null, startingBalances: {}, totalsByMeasure: {}, goals: [], book: null }) as unknown as WritingProjectRow;

const projects = () => [project("wprj_a", "Alpha Draft"), project("wprj_b", "Beta Draft"), project("wprj_c", "Gamma Draft")];

const titles = () => [...document.querySelectorAll("[data-sortable-row]")].map((card) => within(card as HTMLElement).getByRole("link").textContent);

beforeEach(() => {
  m.refresh.mockReset();
  m.reorder.mockReset().mockResolvedValue({ success: true });
});
afterEach(cleanup);

describe("ProjectsClient reordering", () => {
  it("lists the projects in the order it is given, each with a grip and Move buttons", () => {
    render(<ProjectsClient initialProjects={projects()} />);
    expect(titles()).toEqual(["Alpha Draft", "Beta Draft", "Gamma Draft"]);
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: /^Reorder Beta Draft/ })).toHaveAttribute("aria-roledescription", "sortable");
  });

  it("has no ordering controls for a single project", () => {
    render(<ProjectsClient initialProjects={[project("wprj_a", "Alpha Draft")]} />);
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });

  it("disables Move up on the first card and Move down on the last", () => {
    render(<ProjectsClient initialProjects={projects()} />);
    expect(screen.getByRole("button", { name: "Move Alpha Draft up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Alpha Draft down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Gamma Draft down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Gamma Draft up" })).toBeEnabled();
  });

  it("moves a project down with its button, shows it at once, saves the whole order and refreshes", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    await userEvent.click(screen.getByRole("button", { name: "Move Alpha Draft down" }));
    expect(titles()).toEqual(["Beta Draft", "Alpha Draft", "Gamma Draft"]);
    expect(m.reorder).toHaveBeenCalledWith(["wprj_b", "wprj_a", "wprj_c"]);
    await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("Alpha Draft moved to position 2 of 3.")).toBeInTheDocument();
  });

  it("moves a project up with its button", async () => {
    render(<ProjectsClient initialProjects={projects()} />);
    await userEvent.click(screen.getByRole("button", { name: "Move Gamma Draft up" }));
    expect(m.reorder).toHaveBeenCalledWith(["wprj_a", "wprj_c", "wprj_b"]);
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
    await userEvent.click(screen.getByRole("button", { name: "Move Alpha Draft down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the new order");
    expect(titles()).toEqual(["Alpha Draft", "Beta Draft", "Gamma Draft"]);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("puts the list back when the request itself fails", async () => {
    m.reorder.mockRejectedValue(new Error("network"));
    render(<ProjectsClient initialProjects={projects()} />);
    await userEvent.click(screen.getByRole("button", { name: "Move Beta Draft up" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(titles()).toEqual(["Alpha Draft", "Beta Draft", "Gamma Draft"]);
  });

  it("follows the page's list once it brings a new one", async () => {
    const { rerender } = render(<ProjectsClient initialProjects={projects()} />);
    await userEvent.click(screen.getByRole("button", { name: "Move Alpha Draft down" }));
    const [a, b, c] = projects();
    rerender(<ProjectsClient initialProjects={[b, a, c]} />);
    expect(titles()).toEqual(["Beta Draft", "Alpha Draft", "Gamma Draft"]);
    rerender(<ProjectsClient initialProjects={[c, b, a]} />);
    expect(titles()).toEqual(["Gamma Draft", "Beta Draft", "Alpha Draft"]);
  });
});

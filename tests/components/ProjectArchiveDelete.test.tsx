// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import ArchivedProjects from "@/app/(member)/projects/ArchivedProjects";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";

const { archiveProject, restoreProject, deleteProject } = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ deleteBook: vi.fn(), addBook: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/app/(member)/projects/actions", () => ({
  archiveGoal: vi.fn(),
  archiveProject,
  restoreProject,
  deleteProject,
  createGoal: vi.fn(),
  deleteEntry: vi.fn(),
  deleteGoal: vi.fn(),
  toggleGoalStar: vi.fn(),
  toggleGoalVisibility: vi.fn(),
  toggleProjectVisibility: vi.fn(),
  updateGoal: vi.fn(),
  updateProjectPhase: vi.fn(),
}));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectCharts", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectDetailsModal", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));

const row = (over: Partial<WritingProjectRow> = {}) =>
  ({
    id: "prj_AAAAAAAAAAA1",
    title: "Lantern Draft",
    phase: "drafting",
    createdAt: "2026-01-01T00:00:00Z",
    showOnProfile: false,
    coverUrl: null,
    description: null,
    archivedAt: null,
    startingBalances: {},
    totalsByMeasure: {},
    goals: [],
    book: null,
    ...over,
  }) as unknown as WritingProjectRow;

const reload = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  archiveProject.mockResolvedValue({ success: true });
  restoreProject.mockResolvedValue({ success: true });
  deleteProject.mockResolvedValue({ success: true });
  Object.defineProperty(window, "location", { configurable: true, value: { reload, href: "/projects/prj_AAAAAAAAAAA1" } });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("ProjectDetailClient archive and delete", () => {
  it("archives the project and reloads", async () => {
    render(<ProjectDetailClient project={row()} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archiveProject).toHaveBeenCalledWith("prj_AAAAAAAAAAA1");
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("offers Restore on an archived project", async () => {
    render(<ProjectDetailClient project={row({ archivedAt: "2026-03-01T00:00:00Z" })} entries={[]} archivedGoals={[]} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restoreProject).toHaveBeenCalledWith("prj_AAAAAAAAAAA1");
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("shows the error when archiving fails", async () => {
    archiveProject.mockResolvedValue({ error: "Project not found" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<ProjectDetailClient project={row()} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Project not found"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("asks before deleting, and does nothing when declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProjectDetailClient project={row()} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Lantern Draft"));
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("deletes after confirming and goes back to My Writing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProjectDetailClient project={row()} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteProject).toHaveBeenCalledWith("prj_AAAAAAAAAAA1");
    await waitFor(() => expect(window.location.href).toBe("/projects"));
  });

  it("stays on the page and says why when the delete fails", async () => {
    deleteProject.mockResolvedValue({ error: "Failed to delete project" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<ProjectDetailClient project={row()} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Failed to delete project"));
    expect(window.location.href).toBe("/projects/prj_AAAAAAAAAAA1");
  });

  it("says the book stays when the project has one", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const book = { id: "b1", title: "B", description: null, coverUrl: "https://example.com/c.png", purchaseUrl: "https://example.com/b", publishedDate: "2025-06-15", price: null, genres: [], format: "ebook", projectId: "prj_AAAAAAAAAAA1" };
    render(<ProjectDetailClient project={row({ book } as unknown as Partial<WritingProjectRow>)} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Book Shelf stays"));
  });
});

describe("ArchivedProjects", () => {
  it("renders nothing without archived projects", () => {
    const { container } = render(<ArchivedProjects projects={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists archived projects with their totals and links to each", () => {
    render(<ArchivedProjects projects={[row({ archivedAt: "2026-03-01T00:00:00Z", totalsByMeasure: { words: 12000 } })]} />);
    expect(screen.getByText("Archived (1)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lantern Draft" })).toHaveAttribute("href", "/projects/prj_AAAAAAAAAAA1");
    expect(screen.getByText(/12,000 words/)).toBeInTheDocument();
  });

  it("restores a project and reloads", async () => {
    render(<ArchivedProjects projects={[row({ archivedAt: "2026-03-01T00:00:00Z" })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restoreProject).toHaveBeenCalledWith("prj_AAAAAAAAAAA1");
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("keeps the project listed and says why when restoring fails", async () => {
    restoreProject.mockResolvedValue({ error: "Project not found" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<ArchivedProjects projects={[row({ archivedAt: "2026-03-01T00:00:00Z" })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Project not found"));
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(reload).not.toHaveBeenCalled();
  });
});

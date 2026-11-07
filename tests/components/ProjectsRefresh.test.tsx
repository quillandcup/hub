// @vitest-environment jsdom
/**
 * After a project is created, the list refreshes in place. It used to call window.location.reload(), which cancels the
 * server action's response while the browser is still reading it: Firefox and Safari report that as "Error in input
 * stream" / "Load failed", and the crash reporter posted it to #hub-alerts although the project was saved
 * (Sentry HUB-T, HUB-5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectsClient from "@/app/(member)/projects/ProjectsClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/app/(member)/projects/actions", () => ({}));
vi.mock("@/components/writing/NewProjectModal", () => ({
  default: ({ onCreated }: { onCreated: () => void }) => (
    <button type="button" onClick={onCreated}>
      project saved
    </button>
  ),
}));
vi.mock("@/components/writing/TrackbearImportModal", () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button type="button" onClick={onImported}>
      import finished
    </button>
  ),
}));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));
vi.mock("@/app/(member)/projects/PastProjects", () => ({ default: () => null }));

const project = {
  id: "wpr_AAAAAAAAAAA1",
  title: "Lantern Draft Two",
  phase: "drafting",
  createdAt: "2026-01-01T00:00:00Z",
  showOnProfile: false,
  coverUrl: null,
  description: null,
  startingBalances: {},
  totalsByMeasure: {},
  goals: [],
  book: null,
} as unknown as WritingProjectRow;

const reload = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  reload.mockReset();
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true });
});

afterEach(cleanup);

describe("ProjectsClient after a change", () => {
  it.each([
    ["a project is created", "project saved"],
    ["a TrackBear import finishes", "import finished"],
  ])("refreshes the page's data in place when %s, without reloading it", async (_when, button) => {
    render(<ProjectsClient initialProjects={[project]} />);
    await userEvent.click(screen.getAllByRole("button", { name: button })[0]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does the same from the empty state", async () => {
    render(<ProjectsClient initialProjects={[]} />);
    await userEvent.click(screen.getAllByRole("button", { name: "project saved" })[0]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrickleWritingPanel from "@/components/writing/PrickleWritingPanel";
import type { PrickleEntryRow } from "@/app/(member)/projects/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/prickles/checkin-actions", () => ({
  getCheckinForLogging: vi.fn().mockResolvedValue({ checkin: null, canEdit: true }),
  saveCheckin: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/app/(member)/projects/actions", () => ({
  getPricklesOnDate: vi.fn().mockResolvedValue([]),
  logProgress: vi.fn(),
  updateEntry: vi.fn(),
}));

const PROJECTS = [{ id: "project-1", title: "My Novel" }];

const ENTRY: PrickleEntryRow = {
  id: "entry-1",
  projectId: "project-1",
  projectTitle: "My Novel",
  entryDate: "2026-10-01",
  measure: "words",
  mode: "delta",
  amount: 1200,
  note: "Finished chapter 3",
  tags: [],
  createdAt: "2026-10-01T15:00:00Z",
  prickleId: "prickle-1",
  prickleLabel: "Thu, Oct 1 · 9:00 AM · Morning Sprint",
};

describe("PrickleWritingPanel", () => {
  it("prompts an attendee with no entries and opens the log modal", async () => {
    render(<PrickleWritingPanel prickleId="prickle-1" entryDate="2026-10-01" attended projects={PROJECTS} entries={[]} />);
    expect(screen.getByText("You were here. What did you work on?")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Log progress" }));
    expect(screen.getByRole("heading", { name: "Log Progress" })).toBeInTheDocument();
  });

  it("asks a non-attendee whether they were here", () => {
    render(
      <PrickleWritingPanel prickleId="prickle-1" entryDate="2026-10-01" attended={false} projects={PROJECTS} entries={[]} />
    );
    expect(screen.getByText("Were you here? Log what you worked on.")).toBeInTheDocument();
  });

  it("lists what the member logged here, linking to the project", () => {
    render(
      <PrickleWritingPanel prickleId="prickle-1" entryDate="2026-10-01" attended projects={PROJECTS} entries={[ENTRY]} />
    );
    expect(screen.getByText("+1,200 Words")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Novel" })).toHaveAttribute("href", "/projects/project-1");
    expect(screen.getByText("· Finished chapter 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log more" })).toBeInTheDocument();
  });

  it("points members without projects at /projects", () => {
    render(<PrickleWritingPanel prickleId="prickle-1" entryDate="2026-10-01" attended projects={[]} entries={[]} />);
    expect(screen.getByRole("link", { name: "Start tracking your writing →" })).toHaveAttribute("href", "/projects");
    expect(screen.queryByRole("button", { name: "Log progress" })).not.toBeInTheDocument();
  });
});

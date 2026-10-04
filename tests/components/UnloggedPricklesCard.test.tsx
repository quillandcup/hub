// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UnloggedPricklesCard from "@/components/writing/UnloggedPricklesCard";
import { dismissUnloggedPrickle } from "@/app/(member)/projects/actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/prickles/checkin-actions", () => ({
  getCheckinForLogging: vi.fn().mockResolvedValue({ checkin: null, canEdit: true }),
  saveCheckin: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/app/(member)/projects/actions", () => ({
  dismissUnloggedPrickle: vi.fn(),
  getPricklesOnDate: vi.fn().mockResolvedValue([]),
  logProgress: vi.fn(),
  updateEntry: vi.fn(),
}));

const PROJECTS = [{ id: "project-1", title: "My Novel" }];
const PRICKLES = [
  { id: "p1", label: "Thu, Oct 1 · 9:00 AM · Morning Sprint", startTime: "2026-10-01T13:00:00Z", attended: true, entryDate: "2026-10-01" },
  { id: "p2", label: "Wed, Sep 30 · 7:00 PM · Night Owls", startTime: "2026-09-30T23:00:00Z", attended: true, entryDate: "2026-09-30" },
];

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(dismissUnloggedPrickle).mockReset().mockResolvedValue({ success: true });
});

describe("UnloggedPricklesCard", () => {
  it("dismisses a prickle: hides it, saves it and refreshes", async () => {
    render(<UnloggedPricklesCard prickles={PRICKLES} projects={PROJECTS} />);

    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${PRICKLES[0].label}` }));

    expect(screen.queryByText(PRICKLES[0].label)).not.toBeInTheDocument();
    expect(screen.getByText(PRICKLES[1].label)).toBeInTheDocument();
    expect(dismissUnloggedPrickle).toHaveBeenCalledWith("p1");
    expect(refresh).toHaveBeenCalled();
  });

  it("disappears once every prickle is dismissed", async () => {
    const { container } = render(<UnloggedPricklesCard prickles={[PRICKLES[0]]} projects={PROJECTS} />);
    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${PRICKLES[0].label}` }));
    expect(container).toBeEmptyDOMElement();
  });

  it("brings the prickle back with an error when the save fails", async () => {
    vi.mocked(dismissUnloggedPrickle).mockResolvedValue({ error: "Couldn't dismiss that prickle — please try again." });
    render(<UnloggedPricklesCard prickles={PRICKLES} projects={PROJECTS} />);

    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${PRICKLES[0].label}` }));

    expect(await screen.findByText("Couldn't dismiss that prickle — please try again.")).toBeInTheDocument();
    expect(screen.getByText(PRICKLES[0].label)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still logs progress from a row", async () => {
    render(<UnloggedPricklesCard prickles={PRICKLES} projects={PROJECTS} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Log" })[0]);
    expect(screen.getByRole("heading", { name: "Log Progress" })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommitmentsManager from "@/app/(member)/my-prickles/CommitmentsManager";
import { cancelCommitment, createCommitment, type MyCommitment } from "@/app/(member)/my-prickles/commitment-actions";
import type { CommitmentSlotOption } from "@/lib/commitments";

vi.mock("@/app/(member)/my-prickles/commitment-actions", () => ({
  createCommitment: vi.fn(),
  cancelCommitment: vi.fn(),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const MONDAY_SLOT: CommitmentSlotOption = {
  key: "type-a:1-07:00",
  typeId: "type-a",
  dayOfWeek: 1,
  startTimeLocal: "07:00",
  timezone: "America/New_York",
  typeName: "Progress Prickle",
  label: "Monday 7:00 AM EDT · Progress Prickle with Host A",
  nextDate: "2026-09-28",
};
const THURSDAY_SLOT: CommitmentSlotOption = {
  key: "type-b:4-19:30",
  typeId: "type-b",
  dayOfWeek: 4,
  startTimeLocal: "19:30",
  timezone: "America/New_York",
  typeName: "Sprint",
  label: "Thursday 7:30 PM EDT · Sprint",
  nextDate: "2026-10-01",
};

const ACTIVE: MyCommitment = {
  id: "c1",
  typeId: "type-a",
  typeName: "Progress Prickle",
  label: "Progress Prickle · every Monday · 7 AM EDT",
  dayOfWeek: 1,
  startTimeLocal: "07:00",
  timezone: "America/New_York",
  startDate: "2026-09-14",
  endDate: "2026-10-11",
  weeks: 4,
  status: "active",
  progress: {
    occurrences: [
      { date: "2026-09-14", expectedStart: "2026-09-14T11:00:00.000Z", prickleId: "p1", status: "kept" },
      { date: "2026-09-21", expectedStart: "2026-09-21T11:00:00.000Z", prickleId: "p2", status: "missed" },
      { date: "2026-09-28", expectedStart: "2026-09-28T11:00:00.000Z", prickleId: "p3", status: "upcoming" },
      { date: "2026-10-05", expectedStart: "2026-10-05T11:00:00.000Z", prickleId: "p4", status: "upcoming" },
    ],
    kept: 1,
    missed: 1,
    pending: 0,
    upcoming: 2,
    noSession: 0,
    effectiveStatus: "active",
  },
};
const COMPLETED: MyCommitment = {
  ...ACTIVE,
  id: "c0",
  startDate: "2026-08-03",
  endDate: "2026-08-16",
  weeks: 2,
  status: "completed",
  progress: {
    ...ACTIVE.progress,
    occurrences: ACTIVE.progress.occurrences.slice(0, 2),
    upcoming: 0,
    effectiveStatus: "completed",
  },
};

beforeEach(() => {
  vi.mocked(createCommitment).mockReset();
  vi.mocked(cancelCommitment).mockReset();
  refresh.mockReset();
});

describe("CommitmentsManager", () => {
  it("lets a member pick a slot and number of weeks, previews the window, and submits", async () => {
    vi.mocked(createCommitment).mockResolvedValue({ success: true, id: "new" });
    const user = userEvent.setup();
    render(<CommitmentsManager slots={[MONDAY_SLOT, THURSDAY_SLOT]} commitments={[]} />);

    expect(screen.getByText("No active commitments yet.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Prickle"), THURSDAY_SLOT.key);
    expect(screen.getByLabelText("Starting")).toHaveValue("2026-10-01");
    await user.selectOptions(screen.getByLabelText("For"), "6");
    expect(screen.getByText("6 sessions: Thu, Oct 1 – Thu, Nov 5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Commit" }));

    expect(createCommitment).toHaveBeenCalledWith({
      typeId: "type-b",
      dayOfWeek: 4,
      startTimeLocal: "19:30",
      timezone: "America/New_York",
      startDate: "2026-10-01",
      weeks: 6,
    });
    expect(await screen.findByText(/Commitment saved/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("defaults to 4 weeks and preselects a slot from a Commit link", () => {
    render(<CommitmentsManager slots={[MONDAY_SLOT, THURSDAY_SLOT]} commitments={[]} initialSlotKey={MONDAY_SLOT.key} />);
    expect(screen.getByLabelText("Prickle")).toHaveValue(MONDAY_SLOT.key);
    expect(screen.getByLabelText("For")).toHaveValue("4");
    expect(screen.getByText("4 sessions: Mon, Sep 28 – Mon, Oct 19")).toBeInTheDocument();
  });

  it("shows a validation error without calling the server when no slot is picked", async () => {
    const user = userEvent.setup();
    render(<CommitmentsManager slots={[MONDAY_SLOT]} commitments={[]} />);
    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a prickle to commit to");
    expect(createCommitment).not.toHaveBeenCalled();
  });

  it("shows a server error", async () => {
    vi.mocked(createCommitment).mockResolvedValue({ error: "You're already committed to this prickle through 2026-10-11" });
    const user = userEvent.setup();
    render(<CommitmentsManager slots={[MONDAY_SLOT]} commitments={[]} initialSlotKey={MONDAY_SLOT.key} />);
    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already committed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lists active and past commitments with progress", () => {
    render(<CommitmentsManager slots={[MONDAY_SLOT]} commitments={[ACTIVE, COMPLETED]} />);
    expect(screen.getByText("1 kept · 1 missed · 2 to go")).toBeInTheDocument();
    expect(screen.getByText("Past commitments")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Mon, Sep 14: Kept")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1); // only the active one
  });

  it("cancels an active commitment after confirmation", async () => {
    vi.mocked(cancelCommitment).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CommitmentsManager slots={[MONDAY_SLOT]} commitments={[ACTIVE]} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelCommitment).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));

    expect(cancelCommitment).toHaveBeenCalledWith("c1");
    expect(refresh).toHaveBeenCalled();
  });
});

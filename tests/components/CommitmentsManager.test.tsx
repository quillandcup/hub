// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommitmentsManager from "@/app/(member)/my-prickles/CommitmentsManager";
import { cancelCommitment, type MyCommitment } from "@/app/(member)/my-prickles/commitment-actions";
import type { CommitmentOccurrence, OccurrenceStatus, ProgressCounts } from "@/lib/commitments";

// The Commitments tab lists commitments (made from All Prickles) with progress, and cancels them.

vi.mock("@/app/(member)/my-prickles/commitment-actions", () => ({ cancelCommitment: vi.fn() }));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ET = "America/New_York";

function occ(slotIndex: number, week: number, date: string, status: OccurrenceStatus): CommitmentOccurrence {
  return { slotIndex, week, date, expectedStart: `${date}T09:00:00.000Z`, prickleId: `${date}-p`, status };
}

function counts(c: Partial<ProgressCounts>): ProgressCounts {
  return { kept: 0, missed: 0, pending: 0, upcoming: 0, noSession: 0, ...c };
}

// M/W/F 5am for 2 weeks: week 1 kept M, missed W, kept F; week 2 all upcoming.
const MWF: MyCommitment = {
  id: "c1",
  title: "Sprint · Mon, Wed, Fri · 5 AM EDT",
  slots: [
    { typeId: "t1", dayOfWeek: 1, startTimeLocal: "05:00", timezone: ET, typeName: "Sprint", label: "Sprint · every Monday · 5 AM EDT", progress: counts({ kept: 1, upcoming: 1 }) },
    { typeId: "t1", dayOfWeek: 3, startTimeLocal: "05:00", timezone: ET, typeName: "Sprint", label: "Sprint · every Wednesday · 5 AM EDT", progress: counts({ missed: 1, upcoming: 1 }) },
    { typeId: "t1", dayOfWeek: 5, startTimeLocal: "05:00", timezone: ET, typeName: "Sprint", label: "Sprint · every Friday · 5 AM EDT", progress: counts({ kept: 1, upcoming: 1 }) },
  ],
  startDate: "2026-09-21",
  endDate: "2026-10-04",
  weeks: 2,
  status: "active",
  progress: {
    occurrences: [
      occ(0, 1, "2026-09-21", "kept"),
      occ(1, 1, "2026-09-23", "missed"),
      occ(2, 1, "2026-09-25", "kept"),
      occ(0, 2, "2026-09-28", "upcoming"),
      occ(1, 2, "2026-09-30", "upcoming"),
      occ(2, 2, "2026-10-02", "upcoming"),
    ],
    perSlot: [counts({ kept: 1, upcoming: 1 }), counts({ missed: 1, upcoming: 1 }), counts({ kept: 1, upcoming: 1 })],
    kept: 2,
    missed: 1,
    pending: 0,
    upcoming: 3,
    noSession: 0,
    effectiveStatus: "active",
  },
};

const COMPLETED: MyCommitment = {
  id: "c0",
  title: "Deep Work · every Tuesday · 7 PM EDT",
  slots: [
    { typeId: "t2", dayOfWeek: 2, startTimeLocal: "19:00", timezone: ET, typeName: "Deep Work", label: "Deep Work · every Tuesday · 7 PM EDT", progress: counts({ kept: 1 }) },
  ],
  startDate: "2026-08-04",
  endDate: "2026-08-10",
  weeks: 1,
  status: "completed",
  progress: {
    occurrences: [occ(0, 1, "2026-08-04", "kept")],
    perSlot: [counts({ kept: 1 })],
    kept: 1,
    missed: 0,
    pending: 0,
    upcoming: 0,
    noSession: 0,
    effectiveStatus: "completed",
  },
};

beforeEach(() => {
  vi.mocked(cancelCommitment).mockReset();
  refresh.mockReset();
});

describe("CommitmentsManager", () => {
  it("points members to All Prickles to make a commitment (no slot dropdown here)", () => {
    render(<CommitmentsManager commitments={[]} />);
    expect(screen.getByText(/No active commitments yet/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href", "/my-prickles?tab=all&commit=");
    }
    expect(screen.getByRole("link", { name: /Make a commitment/ })).toBeInTheDocument();
  });

  it("shows a multi-slot commitment's total progress and a dot row per slot", () => {
    render(<CommitmentsManager commitments={[MWF, COMPLETED]} />);
    expect(screen.getByText("Sprint · Mon, Wed, Fri · 5 AM EDT")).toBeInTheDocument();
    expect(screen.getByText("2 kept · 1 missed · 3 to go")).toBeInTheDocument();

    const wednesday = screen.getByRole("list", { name: "Sprint · every Wednesday · 5 AM EDT weekly progress" });
    expect(within(wednesday).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
      "Wed, Sep 23: Missed",
      "Wed, Sep 30: Upcoming",
    ]);
    expect(screen.getByText("every Monday · 5 AM EDT")).toBeInTheDocument();

    expect(screen.getByText("Past commitments")).toBeInTheDocument();
    expect(screen.getByLabelText("Tue, Aug 4: Kept")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1); // only the active one
  });

  it("cancels an active commitment after confirmation", async () => {
    vi.mocked(cancelCommitment).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CommitmentsManager commitments={[MWF]} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelCommitment).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));

    expect(cancelCommitment).toHaveBeenCalledWith("c1");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a cancel error", async () => {
    vi.mocked(cancelCommitment).mockResolvedValue({ error: "Only active commitments can be cancelled" });
    const user = userEvent.setup();
    render(<CommitmentsManager commitments={[MWF]} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect(await screen.findByText("Only active commitments can be cancelled")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

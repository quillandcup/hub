// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostingScheduleManager from "@/app/(member)/hosting/HostingScheduleManager";
import { requestToHost, updateMySchedule, withdrawMySchedule, getHostingCalendarContext } from "@/app/(member)/hosting/actions";
import type { MyScheduleRow } from "@/app/(member)/hosting/actions";

vi.mock("@/app/(member)/hosting/actions", () => ({
  requestToHost: vi.fn(),
  updateMySchedule: vi.fn(),
  withdrawMySchedule: vi.fn(),
  getHostingCalendarContext: vi.fn(),
}));

// HostingCalendarPicker renders CalendarWeekView, which calls useRouter().
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

beforeEach(() => {
  vi.mocked(requestToHost).mockReset();
  vi.mocked(updateMySchedule).mockReset();
  vi.mocked(withdrawMySchedule).mockReset();
  vi.mocked(getHostingCalendarContext).mockReset();
  vi.mocked(getHostingCalendarContext).mockResolvedValue({ prickles: [], proposedSlots: [] });
  // handleChanged() calls window.location.reload(); stub it so jsdom doesn't
  // throw "Not implemented: navigation".
  // @ts-expect-error -- test stub
  delete window.location;
  // @ts-expect-error -- test stub
  window.location = { reload: vi.fn() };
});

const prickleTypes = [{ id: "type-a", name: "Progress Prickle" }];

const currentMonth = "2026-09-01";
const nextMonth = "2026-10-01";

const confirmedSchedule: MyScheduleRow = {
  id: "s1",
  typeId: "type-a",
  typeName: "Progress Prickle",
  month: currentMonth,
  recurrenceType: "weekly",
  dayOfWeek: 2,
  recurrenceAnchorDate: null,
  weekOfMonth: null,
  eventDate: null,
  startTimeLocal: "19:00",
  timezone: "America/New_York",
  status: "confirmed",
  notes: null,
  carriedForwardFrom: null,
};

function renderManager(schedules: MyScheduleRow[], overrides: Partial<React.ComponentProps<typeof HostingScheduleManager>> = {}) {
  return render(
    <HostingScheduleManager
      initialSchedules={schedules}
      prickleTypes={prickleTypes}
      currentMonth={currentMonth}
      nextMonth={nextMonth}
      currentMonthLocked={true}
      nextMonthLocked={false}
      {...overrides}
    />
  );
}

describe("HostingScheduleManager", () => {
  it("shows an invite to request next month when the member has no schedules", () => {
    renderManager([]);
    expect(screen.getByText(/Want to host October 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request to host" })).toBeInTheDocument();
  });

  it("shows the standard invite to members who have been here a full month", () => {
    renderManager([], {
      hostEligibility: { eligible: true, tenureStartDate: "2025-01-01", eligibleOn: "2025-02-01" },
    });
    expect(screen.getByText(/Want to host October 2026/)).toBeInTheDocument();
  });

  it("doesn't invite brand-new members to host, and says when they can", () => {
    renderManager([], {
      hostEligibility: { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
    });
    expect(screen.queryByText(/Want to host/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request to host" })).not.toBeInTheDocument();
    expect(screen.getByText("Settle in first")).toBeInTheDocument();
    expect(screen.getByText(/for you, that's October 10, 2026/)).toBeInTheDocument();
  });

  it("shows a date-less not-yet message when the join date is unknown", () => {
    renderManager([], { hostEligibility: { eligible: false, tenureStartDate: null, eligibleOn: null } });
    expect(screen.getByText("Settle in first")).toBeInTheDocument();
    expect(screen.queryByText(/for you, that's/)).not.toBeInTheDocument();
  });

  it("still lets a brand-new member request a slot if they ask", async () => {
    vi.mocked(requestToHost).mockResolvedValue({ success: true });
    renderManager([], {
      hostEligibility: { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
    });

    await userEvent.click(screen.getByRole("button", { name: /Request a slot anyway/ }));
    expect(screen.getByText(/Request to host for October 2026/)).toBeInTheDocument();
  });

  it("shows a brand-new member's existing schedules as usual", () => {
    renderManager([confirmedSchedule], {
      hostEligibility: { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
    });
    expect(screen.queryByText("Settle in first")).not.toBeInTheDocument();
    expect(screen.getByText(/Current Month/)).toBeInTheDocument();
  });

  it("opens the request form from the empty-state CTA and submits a weekly request", async () => {
    vi.mocked(requestToHost).mockResolvedValue({ success: true });
    renderManager([]);

    await userEvent.click(screen.getByRole("button", { name: "Request to host" }));
    expect(screen.getByText(/Request to host for October 2026/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Prickle type"), "type-a");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(requestToHost).toHaveBeenCalledWith(
      expect.objectContaining({ month: nextMonth, typeId: "type-a", recurrenceType: "weekly", dayOfWeek: 1 })
    );
  });

  it("shows an error inline when the request fails", async () => {
    vi.mocked(requestToHost).mockResolvedValue({ error: "This month is locked" });
    renderManager([]);

    await userEvent.click(screen.getByRole("button", { name: "Request to host" }));
    await userEvent.selectOptions(screen.getByLabelText("Prickle type"), "type-a");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("This month is locked")).toBeInTheDocument();
  });

  it("renders an existing schedule with its status and disables actions for a locked month", () => {
    renderManager([confirmedSchedule]);

    expect(screen.getByText(/Progress Prickle/)).toBeInTheDocument();
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    // Current month is locked in this render -- no Withdraw button for its row.
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(screen.getByText("🔒 Locked")).toBeInTheDocument();
  });

  it("withdraws a schedule in an unlocked month after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(withdrawMySchedule).mockResolvedValue({ success: true });

    const nextMonthSchedule = { ...confirmedSchedule, id: "s2", month: nextMonth, status: "proposed" as const };
    renderManager([nextMonthSchedule]);

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(withdrawMySchedule).toHaveBeenCalledWith("s2");
  });
});

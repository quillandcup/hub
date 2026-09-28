// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AllPricklesTable from "@/app/(member)/my-prickles/AllPricklesTable";
import type { PrickleScheduleRow } from "@/lib/prickle-schedule";
import type { MyCalendarItem } from "@/lib/calendar-feed";

// The All Prickles table's per-row "add to my calendar" control (AddToCalendar): which rows show
// as already added, hosted, or committed.

const addPrickle = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  addPrickleToMyCalendar: (...args: unknown[]) => addPrickle(...(args as [])),
  addEventToMyCalendar: vi.fn(),
  removeMyCalendarItem: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const TZ = "America/Los_Angeles"; // a viewer outside the schedule's timezone

function row(key: string, typeId: string, typeName: string, next: string, hostId: string | null = null): PrickleScheduleRow {
  return {
    seriesKey: key,
    sortKey: `2-${key}`,
    dayOfWeek: "Tuesday",
    timeLabel: "4:00 PM PDT",
    typeId,
    typeName,
    nextOccurrenceId: `next-${key}`,
    nextOccurrenceStart: next,
    hostId,
    hostName: hostId ? "Jenn Parker" : null,
    sessionCount: 3,
    avgAttendance: 4,
  };
}

// Tue 2026-10-06 23:00Z = 7:00 PM EDT (schedule tz) = 4:00 PM PDT (viewer tz).
const EDU = row("edu", "t-edu", "Educational Prickle", "2026-10-06T23:00:00Z");
const SPRINT = row("sprint", "t-sprint", "Sprint", "2026-10-06T23:00:00Z");
const HOSTED = row("hosted", "t-host", "Progress Prickle", "2026-10-06T23:00:00Z", "me");
const COMMITTED = row("committed", "t-commit", "Plot or Plan", "2026-10-06T23:00:00Z");

function renderTable(items: MyCalendarItem[]) {
  render(
    <AllPricklesTable
      rows={[EDU, SPRINT, HOSTED, COMMITTED]}
      calendar={{
        items,
        memberId: "me",
        timeZone: TZ,
        // Commitment slots are keyed in the schedule's timezone, whatever the viewer's.
        committedSlotKeys: new Set(["t-commit|2|19:00|America/New_York"]),
      }}
    />
  );
}

describe("All Prickles calendar column", () => {
  it("marks a row whose weekly slot (in the schedule's timezone) is added", () => {
    renderTable([{ id: "i1", kind: "slot", label: "", slotKey: "t-edu|2|19:00|America/New_York" }]);
    expect(screen.getByRole("button", { name: "Tuesday 4:00 PM PDT Educational Prickle is in your calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Tuesday 4:00 PM PDT Sprint to your calendar" })).toBeInTheDocument();
  });

  it("marks a row whose next occurrence is added", () => {
    renderTable([{ id: "i2", kind: "prickle", label: "", prickleId: "next-sprint" }]);
    expect(screen.getByRole("button", { name: "Tuesday 4:00 PM PDT Sprint is in your calendar" })).toBeInTheDocument();
  });

  it("shows hosted and committed rows as already included", () => {
    renderTable([]);
    expect(screen.getByRole("img", { name: "In your calendar: you're hosting" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "In your calendar: you're committed" })).toBeInTheDocument();
  });

  it("adds a row's next occurrence by its prickle id", async () => {
    const user = userEvent.setup();
    renderTable([]);
    await user.click(screen.getByRole("button", { name: "Add Tuesday 4:00 PM PDT Educational Prickle to your calendar" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Just this one · Tue, Oct 6/ }));
    expect(addPrickle).toHaveBeenCalledWith("next-edu", "once");
  });
});

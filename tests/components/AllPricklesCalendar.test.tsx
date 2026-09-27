// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AllPricklesCalendar from "@/app/(member)/my-prickles/AllPricklesCalendar";
import type { PrickleInstance } from "@/lib/prickle-schedule";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// "Now" is Wednesday 2026-09-23 at noon (local), so this week starts Sunday 9/20.
// lookbackDays=28 -> cutoff Wed 8/26, in the partial week of Sun 8/23; first full week is 8/30.
// upcomingWindowDays=14 -> Wed 10/7, so the last navigable week is Sun 10/4.
const NOW = new Date(2026, 8, 23, 12, 0, 0);
const TZ = "America/New_York";

function instance(id: string, typeName: string, startTime: string): PrickleInstance {
  const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();
  return { id, seriesKey: `t-${id}:slot`, typeId: `t-${id}`, typeName, hostId: "h1", hostName: "Penny Quill", startTime, endTime };
}

const INSTANCES = [
  instance("past-this-week", "Monday Morning Sprint", "2026-09-21T15:00:00.000Z"),
  instance("prior-week", "Earlier Deep Work", "2026-09-08T16:00:00.000Z"),
  instance("next-week", "Future Focus Hour", "2026-09-29T16:00:00.000Z"),
];

function renderCalendar() {
  render(<AllPricklesCalendar instances={INSTANCES} timeZone={TZ} upcomingWindowDays={14} lookbackDays={28} />);
  return {
    prev: screen.getByRole("button", { name: /Prev/ }),
    next: screen.getByRole("button", { name: /Next/ }),
    thisWeek: screen.getByRole("button", { name: "This Week" }),
  };
}

// The type filter <select> also lists every type name; only look at calendar blocks.
const CALENDAR_ONLY = { ignore: "script, style, option" };

/** The Sunday column header is the first "M/D" label CalendarWeekView renders for the week. */
function expectWeekStarting(label: string) {
  expect(screen.getByText(label)).toBeInTheDocument();
}

describe("AllPricklesCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a prickle from earlier in the current week, not just upcoming ones", () => {
    renderCalendar();
    expectWeekStarting("9/20");
    expect(screen.getByText("Monday Morning Sprint", CALENDAR_ONLY)).toBeInTheDocument();
    expect(screen.queryByText("Earlier Deep Work", CALENDAR_ONLY)).not.toBeInTheDocument();
  });

  it("lets Prev walk back to the first full week inside the lookback window, then disables it", () => {
    const { prev } = renderCalendar();
    expect(prev).toBeEnabled();

    fireEvent.click(prev);
    expectWeekStarting("9/13");
    expect(prev).toBeEnabled();

    fireEvent.click(prev);
    expectWeekStarting("9/6");
    expect(screen.getByText("Earlier Deep Work", CALENDAR_ONLY)).toBeInTheDocument();
    expect(prev).toBeEnabled();

    fireEvent.click(prev);
    expectWeekStarting("8/30");
    expect(prev).toBeDisabled();

    // Never reaches the partial week (8/23) the lookback cutoff falls in.
    fireEvent.click(prev);
    expectWeekStarting("8/30");
    expect(screen.queryByText("8/23")).not.toBeInTheDocument();
  });

  it("disables Next at the week containing the end of the upcoming window", () => {
    const { next, prev } = renderCalendar();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expectWeekStarting("9/27");
    expect(screen.getByText("Future Focus Hour", CALENDAR_ONLY)).toBeInTheDocument();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expectWeekStarting("10/4");
    expect(next).toBeDisabled();
    expect(prev).toBeEnabled();
  });

  it("returns to the current week with This Week", () => {
    const { prev, thisWeek } = renderCalendar();
    fireEvent.click(prev);
    fireEvent.click(prev);
    expectWeekStarting("9/6");

    fireEvent.click(thisWeek);
    expectWeekStarting("9/20");
    expect(screen.getByText("Monday Morning Sprint", CALENDAR_ONLY)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpcomingPrickleRow, { CHECKIN_SOON_MS } from "@/components/UpcomingPrickleRow";
import type { HighlightReason, UpcomingPrickle } from "@/lib/upcoming-prickles";

vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  addPrickleToMyCalendar: vi.fn(async () => ({ success: true })),
  addEventToMyCalendar: vi.fn(async () => ({ success: true })),
  removeMyCalendarItem: vi.fn(async () => ({ success: true })),
}));
import { addPrickleToMyCalendar } from "@/app/(member)/my-prickles/calendar-feed-actions";

const NOW = Date.parse("2026-10-05T15:00:00Z");
const prickle = (startsInMs: number) =>
  ({
    id: "p1",
    typeName: "Progress Prickle",
    hostName: "Jenn Parker",
    startTime: new Date(NOW + startsInMs).toISOString(),
  }) as UpcomingPrickle;

const TIED: HighlightReason[] = [{ kind: "calendar", tooltip: ["You added this one"] }];
const renderRow = (
  startsInMs: number,
  checkin = null as React.ComponentProps<typeof UpcomingPrickleRow>["checkin"],
  reasons: HighlightReason[] = TIED
) => render(<UpcomingPrickleRow prickle={prickle(startsInMs)} reasons={reasons} timeZone="UTC" checkin={checkin} now={NOW} />);

describe("UpcomingPrickleRow check-in pill", () => {
  it("offers Check in → for a prickle starting soon, linking to the check-in modal", () => {
    renderRow(30 * 60 * 1000);
    expect(screen.getByRole("link", { name: "Check in →" })).toHaveAttribute("href", "/my-prickles/history?checkin=p1");
    expect(screen.queryByRole("link", { name: /Check out/ })).not.toBeInTheDocument();
  });

  it("has no pill for a prickle further out", () => {
    renderRow(CHECKIN_SOON_MS + 60_000);
    expect(screen.queryByRole("link", { name: /Check in/ })).not.toBeInTheDocument();
  });

  it("has no pill without a personal tie (hosting, commitment or calendar)", () => {
    renderRow(30 * 60 * 1000, null, [{ kind: "streak", tooltip: ["3-week streak here"] }]);
    expect(screen.queryByRole("link", { name: /Check in/ })).not.toBeInTheDocument();
  });

  it("has no pill once the member dismissed the offer", () => {
    render(<UpcomingPrickleRow prickle={prickle(30 * 60 * 1000)} reasons={TIED} timeZone="UTC" checkinDismissed now={NOW} />);
    expect(screen.queryByRole("link", { name: /Check in/ })).not.toBeInTheDocument();
  });

  it("shows a finished check-in as done", () => {
    renderRow(10 * 60 * 1000, { feelingsBefore: ["calm"], need: "company", sessionRating: null, feelingsAfter: [] });
    expect(screen.getByRole("link", { name: "Checked in ✓" })).toBeInTheDocument();
  });

  it("still links the prickle itself", () => {
    renderRow(30 * 60 * 1000);
    expect(screen.getByRole("link", { name: /Progress Prickle/ })).toHaveAttribute("href", "/prickles/p1");
  });
});

describe("UpcomingPrickleRow add to calendar", () => {
  const calendar = { state: { onceItemId: null, weeklyItemId: null }, nextLabel: "Tue, Oct 6", autoIncluded: null };
  const renderWith = (cal: React.ComponentProps<typeof UpcomingPrickleRow>["calendar"]) =>
    render(<UpcomingPrickleRow prickle={prickle(5 * 60 * 60 * 1000)} reasons={[]} timeZone="UTC" calendar={cal} now={NOW} />);

  it("offers Add to my calendar right on the row, without opening the prickle", async () => {
    renderWith(calendar);
    await userEvent.click(screen.getByRole("button", { name: /Add to my calendar/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /Just this one/ }));
    expect(addPrickleToMyCalendar).toHaveBeenCalledWith("p1", "once");
  });

  it("shows a prickle already in the calendar as added", () => {
    renderWith({ ...calendar, state: { onceItemId: "i1", weeklyItemId: null } });
    expect(screen.getByRole("button", { name: /In my calendar/ })).toBeInTheDocument();
  });

  it("says why a prickle is already in the calendar when the member hosts or committed to it", () => {
    renderWith({ ...calendar, autoIncluded: "committed" });
    expect(screen.getByText("In your calendar: you're committed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to my calendar/ })).not.toBeInTheDocument();
  });

  it("has no calendar control without one (the dashboard's rows)", () => {
    renderWith(null);
    expect(screen.queryByRole("button", { name: /calendar/i })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttendanceListTable from "@/components/AttendanceListTable";
import type { CheckinInput } from "@/lib/prickle-checkins";
const PAGE_SIZE = 25;

const push = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const row = (id: string, prickleId: string, join: string) => ({
  id,
  join_time: join,
  leave_time: new Date(Date.parse(join) + 3600_000).toISOString(),
  prickles: { id: prickleId, host: { id: "h1", name: "Jenn P" }, prickle_types: { name: "Progress Prickle" } },
});
const ATTENDANCE = [row("a1", "p1", "2026-10-05T17:00:00Z"), row("a2", "p2", "2026-10-04T17:00:00Z")];
const DONE: CheckinInput = { feelingsBefore: ["calm"], need: "company", sessionRating: 5, feelingsAfter: ["calm"] };

const onOpenCheck = vi.fn();

function renderTable(props: Partial<React.ComponentProps<typeof AttendanceListTable>> = {}) {
  onOpenCheck.mockClear();
  return render(
    <AttendanceListTable attendance={ATTENDANCE} timezone="UTC" activeListDateKey={undefined} memberId="m1" onOpenCheck={onOpenCheck} {...props} />
  );
}

describe("AttendanceListTable check-in / check-out pills", () => {
  it("shows no pills for a history that isn't the viewer's own", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Check (in|out)/ })).not.toBeInTheDocument();
  });

  it("puts a Check in and a Check out pill side by side on every row", () => {
    renderTable({ checkins: {} });
    expect(screen.getAllByRole("button", { name: "Check in →" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Check out →" })).toHaveLength(2);
  });

  it("shows a finished half as done, still openable", () => {
    renderTable({ checkins: { p1: DONE } });
    expect(screen.getAllByRole("button", { name: "Checked in ✓" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Checked out ✓" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Check in →" })).toHaveLength(1);
  });

  it("asks to open that prickle's modal from a pill without navigating to the prickle", async () => {
    const user = userEvent.setup();
    renderTable({ checkins: {} });
    const secondRow = screen.getAllByRole("row")[screen.getAllByRole("row").length - 1];
    await user.click(within(secondRow).getByRole("button", { name: "Check out →" }));
    expect(onOpenCheck).toHaveBeenCalledWith("p2", "checkout");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("AttendanceListTable pagination", () => {
  // One prickle a day, newest first, as the attendance query returns them.
  const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) =>
    row(`a${i}`, `p${i}`, new Date(Date.UTC(2026, 9, 31, 17) - i * 86_400_000).toISOString())
  );

  it("pages a long history 25 at a time, with a pager", () => {
    renderTable({ attendance: many });
    expect(screen.getAllByRole("row").filter((r) => within(r).queryByText("Progress Prickle"))).toHaveLength(
      PAGE_SIZE
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  it("jumps to the page holding the date it's asked to show", () => {
    // The oldest date is on page 2.
    const oldest = new Date(Date.UTC(2026, 9, 31, 17) - (many.length - 1) * 86_400_000);
    const key = oldest.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    renderTable({ attendance: many, activeListDateKey: key });
    expect(document.getElementById(`list-date-${key.replace(/\//g, "-")}`)).toBeInTheDocument();
  });
});

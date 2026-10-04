// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttendanceListTable from "@/components/AttendanceListTable";
import type { CheckinInput } from "@/lib/prickle-checkins";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/writing/PrickleCheckModal", () => ({
  default: ({ prickleId, half }: { prickleId: string; half: string }) => (
    <div role="dialog">{`${half} modal for ${prickleId}`}</div>
  ),
}));

const row = (id: string, prickleId: string, join: string) => ({
  id,
  join_time: join,
  leave_time: new Date(Date.parse(join) + 3600_000).toISOString(),
  prickles: { id: prickleId, host: { id: "h1", name: "Jenn P" }, prickle_types: { name: "Progress Prickle" } },
});
const ATTENDANCE = [row("a1", "p1", "2026-10-05T17:00:00Z"), row("a2", "p2", "2026-10-04T17:00:00Z")];
const DONE: CheckinInput = { feelingsBefore: ["calm"], need: "gentle", sessionRating: 5, feelingsAfter: ["calm"] };

function renderTable(props: Partial<React.ComponentProps<typeof AttendanceListTable>> = {}) {
  return render(
    <AttendanceListTable attendance={ATTENDANCE} timezone="UTC" activeListDateKey={undefined} memberId="m1" {...props} />
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

  it("opens that prickle's modal from a pill without navigating to the prickle", async () => {
    const user = userEvent.setup();
    renderTable({ checkins: {} });
    const secondRow = screen.getAllByRole("row")[screen.getAllByRole("row").length - 1];
    await user.click(within(secondRow).getByRole("button", { name: "Check out →" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("checkout modal for p2");
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the modal on load for a link from a DM", () => {
    renderTable({ checkins: {}, initialCheck: { prickleId: "p1", half: "checkin", prefill: null } });
    expect(screen.getByRole("dialog")).toHaveTextContent("checkin modal for p1");
  });
});

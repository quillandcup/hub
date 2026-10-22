// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ORG_TIMEZONE } from "@/lib/config";
import AttendanceListTable from "@/components/AttendanceListTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
Element.prototype.scrollIntoView = vi.fn();

const ATTENDANCE = [
  {
    id: "a1",
    join_time: "2026-10-05T11:00:00Z",
    leave_time: "2026-10-05T12:00:00Z",
    prickles: { id: "p1", host: { id: "h1", name: "Ada Example" }, prickle_types: { name: "Progress Prickle" } },
  },
];

const renderTable = (timezone: string) =>
  render(<AttendanceListTable attendance={ATTENDANCE} timezone={timezone} activeListDateKey={undefined} memberId="m1" />);

describe("AttendanceListTable Eastern time", () => {
  it("shows the Eastern start beside a viewer's own zone", () => {
    renderTable("America/Los_Angeles");
    expect(screen.getByText("4:00 AM – 5:00 AM (7:00 AM ET)")).toBeInTheDocument();
  });

  it("adds nothing for a viewer in the org zone", () => {
    renderTable(ORG_TIMEZONE);
    expect(screen.getByText("7:00 AM – 8:00 AM")).toBeInTheDocument();
  });
});

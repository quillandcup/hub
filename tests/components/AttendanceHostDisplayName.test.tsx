// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttendanceListTable from "@/components/AttendanceListTable";
import AttendanceMonthGrid from "@/components/AttendanceMonthGrid";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
Element.prototype.scrollIntoView = vi.fn();

const attendance = (host: { id: string; name: string; display_name: string | null }, id = "a1", typeName = "Midnight Crew") => ({
  id,
  join_time: "2026-10-05T11:00:00Z",
  leave_time: "2026-10-05T12:00:00Z",
  prickles: { id: `p-${id}`, host, prickle_types: { name: typeName } },
});

const BESTIE = { id: "h1", name: "Laura May Best", display_name: "Bestie" };

describe("attendance views name the host by display name", () => {
  it("in the list", () => {
    render(<AttendanceListTable attendance={[attendance(BESTIE)]} timezone="America/New_York" activeListDateKey={undefined} memberId="m1" />);
    expect(screen.getByRole("link", { name: "Bestie" })).toHaveAttribute("href", expect.stringContaining("h1"));
    expect(screen.queryByText("Laura May Best")).not.toBeInTheDocument();
  });

  it("falls back to the legal name in the list when there is no display name", () => {
    render(
      <AttendanceListTable attendance={[attendance({ ...BESTIE, display_name: null })]} timezone="America/New_York" activeListDateKey={undefined} memberId="m1" />
    );
    expect(screen.getByRole("link", { name: "Laura May Best" })).toBeInTheDocument();
  });

  it("sorts the list by the host name shown", async () => {
    render(
      <AttendanceListTable
        attendance={[
          attendance({ id: "h1", name: "Abe Example", display_name: "Zed" }, "a1"),
          attendance({ id: "h2", name: "Zoe Example", display_name: "Amy" }, "a2"),
        ]}
        timezone="America/New_York"
        activeListDateKey={undefined}
        memberId="m1"
      />
    );
    await userEvent.click(screen.getByRole("columnheader", { name: /host/i }));
    const hosts = screen.getAllByRole("link").map((l) => l.textContent);
    expect(hosts).toEqual(["Amy", "Zed"]);
  });

  it("in the month grid", () => {
    render(
      <AttendanceMonthGrid attendance={[attendance(BESTIE)]} timezone="America/New_York" currentMonthDate={new Date(2026, 9, 15)} memberId="m1" />
    );
    expect(screen.getByTitle(/Midnight Crew w\/ Bestie/)).toBeInTheDocument();
    expect(screen.queryByTitle(/Laura/)).not.toBeInTheDocument();
  });
});

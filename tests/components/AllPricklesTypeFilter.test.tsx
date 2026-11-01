// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AllPricklesTable from "@/app/(member)/my-prickles/AllPricklesTable";
import type { PrickleScheduleRow } from "@/lib/prickle-schedule";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const row = (typeId: string, typeName: string): PrickleScheduleRow => ({
  seriesKey: `${typeId}:1-07:00`,
  sortKey: "1-07:00",
  dayOfWeek: "Monday",
  timeLabel: "7:00 AM EDT",
  typeId,
  typeName,
  nextOccurrenceId: `next-${typeId}`,
  nextOccurrenceStart: "2026-10-26T11:00:00Z",
  hostId: null,
  hostName: null,
  sessionCount: 4,
  avgAttendance: 3,
});

describe("AllPricklesTable type filter", () => {
  it("names the filter, so a screen reader doesn't announce an unlabelled combo box", () => {
    render(<AllPricklesTable rows={[row("t1", "Heads Down"), row("t2", "Sprint Prickle")]} timeZone="America/New_York" />);
    expect(screen.getByRole("combobox", { name: "Filter by prickle type" })).toBeInTheDocument();
  });

  it("has no filter at all when there is only one type", () => {
    render(<AllPricklesTable rows={[row("t1", "Heads Down")]} timeZone="America/New_York" />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

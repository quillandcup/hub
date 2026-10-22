// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AllPricklesTable from "@/app/(member)/my-prickles/AllPricklesTable";
import { buildSlotOptions } from "@/lib/commitments";
import type { PrickleScheduleRow } from "@/lib/prickle-schedule";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const ROW: PrickleScheduleRow = {
  seriesKey: "t1:1-07:00",
  sortKey: "1-04:00",
  dayOfWeek: "Monday",
  timeLabel: "4:00 AM PDT",
  typeId: "t1",
  typeName: "Heads Down",
  nextOccurrenceId: "next-1",
  nextOccurrenceStart: "2026-10-26T11:00:00Z", // 7:00 AM EDT
  hostId: null,
  hostName: null,
  sessionCount: 4,
  avgAttendance: 3,
};

describe("Eastern time on All Prickles", () => {
  it("shows the Eastern time beside the row's own", () => {
    render(<AllPricklesTable rows={[ROW]} timeZone="America/Los_Angeles" />);
    expect(screen.getByText("4:00 AM PDT (7:00 AM ET)")).toBeInTheDocument();
  });

  it("leaves the time alone without a viewer zone", () => {
    render(<AllPricklesTable rows={[ROW]} />);
    expect(screen.getByText("4:00 AM PDT")).toBeInTheDocument();
  });

  it("puts it in the commit slot label too", () => {
    expect(buildSlotOptions([ROW], "America/Los_Angeles")[0].label).toBe("Monday 4:00 AM PDT (7:00 AM ET) · Heads Down");
  });
});

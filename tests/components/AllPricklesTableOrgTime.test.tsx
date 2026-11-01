// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AllPricklesTable from "@/app/(member)/my-prickles/AllPricklesTable";
import { SecondaryTimezoneProvider } from "@/components/SecondaryTimezone";
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

describe("Secondary time zone on All Prickles", () => {
  it("shows the Eastern time beside the row's own", () => {
    render(
      <SecondaryTimezoneProvider zone="America/New_York">
        <AllPricklesTable rows={[ROW]} timeZone="America/Los_Angeles" />
      </SecondaryTimezoneProvider>
    );
    expect(screen.getByText("4:00 AM PDT (7:00 AM ET)")).toBeInTheDocument();
  });

  it("leaves the time alone without a secondary zone", () => {
    render(<AllPricklesTable rows={[ROW]} timeZone="America/Los_Angeles" />);
    expect(screen.getByText("4:00 AM PDT")).toBeInTheDocument();
  });

  it("puts it in the commit slot label too", () => {
    expect(buildSlotOptions([ROW], "America/Los_Angeles", "America/New_York")[0].label).toBe("Monday 4:00 AM PDT (7:00 AM ET) · Heads Down");
  });
});

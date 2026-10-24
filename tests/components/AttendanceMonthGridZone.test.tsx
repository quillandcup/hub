// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AttendanceMonthGrid from "@/components/AttendanceMonthGrid";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Cells are calendar days of the month; the attendance and "today" are placed by the displayed zone,
// not the machine's. 2026-09-27T03:30Z is Saturday the 26th 23:30 Eastern.
const TZ = "America/New_York";
const HOSTS = ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
const originalTz = process.env.TZ;

function record(joinIso: string) {
  return {
    id: "a1",
    join_time: joinIso,
    leave_time: new Date(Date.parse(joinIso) + 3600_000).toISOString(),
    prickles: { id: "p1", host: null, prickle_types: { name: "Progress Prickle" } },
  };
}

const cell = (day: string) => screen.getByText(day, { selector: "div" }).parentElement as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("AttendanceMonthGrid in a zone other than the machine's", () => {
  for (const host of HOSTS) {
    it(`places attendance and today by the display zone (machine in ${host})`, () => {
      process.env.TZ = host;
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(host);
      // Just before Eastern midnight on the 26th: the 26th is today and holds the prickle.
      vi.setSystemTime(new Date("2026-09-27T03:30:00Z"));
      const { rerender } = render(
        <AttendanceMonthGrid
          attendance={[record("2026-09-27T03:30:00Z")]}
          timezone={TZ}
          currentMonthDate={new Date(2026, 8, 15)}
          memberId="m1"
        />
      );
      expect(cell("26")).toHaveTextContent("Progress Prickle");
      expect(cell("27")).not.toHaveTextContent("Progress Prickle");
      expect(cell("26").className).toContain("border-plum-500");
      expect(cell("27").className).not.toContain("border-plum-500");

      // An hour later it is the 27th in Eastern.
      vi.setSystemTime(new Date("2026-09-27T04:30:00Z"));
      rerender(
        <AttendanceMonthGrid
          attendance={[record("2026-09-27T03:30:00Z")]}
          timezone={TZ}
          currentMonthDate={new Date(2026, 8, 15)}
          memberId="m1"
        />
      );
      expect(cell("27").className).toContain("border-plum-500");
      expect(cell("26").className).not.toContain("border-plum-500");
    });
  }
});

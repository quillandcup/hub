// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import AllPricklesCalendar from "@/app/(member)/my-prickles/AllPricklesCalendar";

// The calendar opens on the current week as seen in the displayed zone, whatever zone the machine
// (browser) is in. CalendarWeekView is stubbed to capture the week it is given.
const weekProps = vi.fn();
vi.mock("@/components/CalendarWeekView", () => ({
  default: (p: { weekStartDate: { year: number; month: number; day: number } }) => {
    weekProps(p.weekStartDate);
    return null;
  },
}));
vi.mock("@/components/CalendarScrollContainer", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const TZ = "America/New_York";
const HOSTS = ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"];

// [label, instant, expected Sunday (YYYY-MM-DD)]
const CASES: [string, string, string][] = [
  ["Saturday 23:30 Eastern", "2026-09-27T03:30:00Z", "2026-09-20"],
  ["Sunday 00:30 Eastern", "2026-09-27T04:30:00Z", "2026-09-27"],
  ["Saturday 23:30 EST before spring-forward Sunday", "2026-03-08T04:30:00Z", "2026-03-01"],
  ["spring-forward Sunday 00:30 EST", "2026-03-08T05:30:00Z", "2026-03-08"],
  ["spring-forward Sunday 23:30 EDT", "2026-03-09T03:30:00Z", "2026-03-08"],
  ["Saturday 23:30 EDT before fall-back Sunday", "2026-11-01T03:30:00Z", "2026-10-25"],
  ["fall-back Sunday 00:30 EDT", "2026-11-01T04:30:00Z", "2026-11-01"],
  ["fall-back Sunday 23:30 EST", "2026-11-02T04:30:00Z", "2026-11-01"],
];

const originalTz = process.env.TZ;

beforeEach(() => {
  weekProps.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("AllPricklesCalendar current week", () => {
  for (const host of HOSTS) {
    for (const [label, instant, sunday] of CASES) {
      it(`${label} opens the week of ${sunday} with the machine in ${host}`, () => {
        process.env.TZ = host;
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(host);
        vi.setSystemTime(new Date(instant));
        render(<AllPricklesCalendar instances={[]} timeZone={TZ} upcomingWindowDays={14} lookbackDays={28} />);
        const [y, m, d] = sunday.split("-").map(Number);
        expect(weekProps).toHaveBeenLastCalledWith({ year: y, month: m - 1, day: d });
      });
    }
  }
});

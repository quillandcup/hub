// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import CalendarWeekView from "@/components/CalendarWeekView";
import AllPricklesCalendar from "@/app/(member)/my-prickles/AllPricklesCalendar";
import type { PrickleInstance } from "@/lib/prickle-schedule";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/**
 * jsdom has no layout, so these pin the structure that makes the week grid scroll sideways on a phone; the real
 * behaviour (every day can be scrolled into view at every size) is the demo scene `calendar-views`.
 *
 * What broke: the card around the grid was the `@container` box AND `overflow-clip`. A container query box has an
 * inline size that ignores its content, so the 492px grid overflowed it on a 390px phone, and the clip hid the
 * overflow from the scroller outside, which then had nothing to scroll: Thursday to Saturday were simply gone.
 */
function renderCalendar() {
  const instance: PrickleInstance = {
    id: "p1",
    seriesKey: "t1:slot",
    typeId: "t1",
    typeName: "Heads Down",
    hostId: null,
    hostName: null,
    startTime: "2026-09-21T15:00:00.000Z",
    endTime: "2026-09-21T16:00:00.000Z",
  };
  return render(<AllPricklesCalendar instances={[instance]} timeZone="America/New_York" upcomingWindowDays={14} lookbackDays={28} />);
}

describe("CalendarWeekView layout", () => {
  it("never clips the container box sideways, so an overflowing week reaches the scroller around it", () => {
    const { container } = renderCalendar();
    const box = container.querySelector(".\\@container") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.className).not.toMatch(/overflow-(clip|hidden|x-clip|x-hidden)/);
  });

  it("puts the card (background, shadow, rounding) inside the box, as wide as the grid's own minimum", () => {
    const { container } = renderCalendar();
    const card = (container.querySelector(".\\@container") as HTMLElement).firstElementChild as HTMLElement;
    expect(card.className).toContain("min-w-[30.75rem]"); // 2.75rem time column + 7 x 4rem days
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("bg-white");
  });

  it("keeps the time column and the day header's corner at the left while the days scroll", () => {
    const { container } = renderCalendar();
    const stickyLeft = Array.from(container.querySelectorAll("[class*='sticky'][class*='left-0']"));
    expect(stickyLeft.length).toBeGreaterThanOrEqual(2);
    // The day header sits above the time column, which sits above the day cells, so nothing scrolls over them.
    const header = container.querySelector(".sticky.top-0") as HTMLElement;
    expect(header.className).toContain("z-30");
    expect(stickyLeft.some((el) => el.className.includes("z-20"))).toBe(true);
  });

  it("makes the area that scrolls the calendar a named region that the keyboard can reach and scroll", () => {
    const { getByRole } = renderCalendar();
    const region = getByRole("region", { name: "Week calendar" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-auto");
  });

  it("keeps the day columns at a readable minimum and the grid and its minimum width in step", () => {
    const { container } = renderCalendar();
    const grids = Array.from(container.querySelectorAll("[class*='grid-cols-[2.75rem']"));
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) expect(grid.className).toContain("minmax(4rem,1fr)");
  });
});

describe("CalendarWeekView today highlight", () => {
  it("marks today only after mounting, so server and browser clocks in different zones can't fail hydration", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T15:00:00.000Z"));
    const html = renderToString(
      <AllPricklesCalendar instances={[]} timeZone="America/New_York" upcomingWindowDays={14} lookbackDays={28} />,
    );
    expect(html).not.toContain("border-t-plum-500");
    const { container } = renderCalendar();
    expect(container.querySelector(".border-t-plum-500")).not.toBeNull();
    vi.useRealTimers();
  });
});

describe("CalendarWeekView on a server in another zone", () => {
  it("renders the same week whatever zone the host runs in, so the server HTML and the browser's agree", () => {
    const original = process.env.TZ;
    const prickle = {
      id: "p1",
      host: "Host",
      start_time: "2026-06-15T14:00:00Z",
      end_time: "2026-06-15T15:00:00Z",
      prickle_type: "Heads Down",
      attendance_count: 3,
    };
    const htmlIn = (tz: string) => {
      process.env.TZ = tz;
      return renderToString(
        <CalendarWeekView
          prickles={[prickle]}
          weekStartDate={{ year: 2026, month: 5, day: 14 }}
          userTimezonePreference="America/New_York"
          mode="admin"
          attendanceDataThrough="2026-06-16T10:00:00Z"
        />,
      );
    };
    try {
      expect(htmlIn("UTC")).toBe(htmlIn("America/New_York"));
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

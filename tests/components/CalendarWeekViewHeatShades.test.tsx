// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import CalendarWeekView, { type Prickle } from "@/components/CalendarWeekView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const weekStartDate = { year: 2026, month: 5, day: 1 };

function blockFor(count: number) {
  const prickle: Prickle = {
    id: `p${count}`,
    host: "Host",
    start_time: "2026-06-02T10:00:00Z",
    end_time: "2026-06-02T11:00:00Z",
    prickle_type: `Type ${count}`,
    attendance_count: count,
  };
  render(<CalendarWeekView prickles={[prickle]} weekStartDate={weekStartDate} userTimezonePreference="UTC" mode="admin" attendanceDataThrough="2026-06-03T10:00:00Z" />);
  return screen.getByText(`Type ${count}`).closest("a, div[class*='bg-']") as HTMLElement;
}

/**
 * The admin calendar shades each prickle by how many came. White on the 7 to 10 shade (plum-400) is 3.20 against
 * the 4.5 that WCAG AA needs; very dark plum on it is 4.95. Light mode has to keep the dark text; dark mode uses a
 * darker fill (plum-700) and white. The demo's page checks hold the real contrast; this keeps the choice from drifting.
 */
describe("CalendarWeekView attendance shades", () => {
  it("uses dark text on the 7 to 10 shade in light mode and white in dark mode", () => {
    const block = blockFor(8);
    expect(block.className).toContain("bg-plum-400");
    expect(block.className).toContain("text-plum-950");
    expect(block.className).toContain("dark:text-white");
    expect(block.className).not.toMatch(/(^|\s)text-white(\s|$)/);
  });

  it("keeps white on the darkest shade (11 or more), where it passes", () => {
    const block = blockFor(12);
    expect(block.className).toContain("bg-plum-600");
    expect(block.className).toMatch(/(^|\s)text-white(\s|$)/);
  });

  it("shades the lower levels lighter, each with dark text", () => {
    expect(blockFor(2).className).toContain("bg-plum-100");
    expect(blockFor(5).className).toContain("bg-plum-200");
  });
});

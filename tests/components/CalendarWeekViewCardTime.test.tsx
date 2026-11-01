// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ORG_TIMEZONE } from "@/lib/config";
import { SecondaryTimezoneProvider } from "@/components/SecondaryTimezone";
import CalendarWeekView, { type Prickle } from "@/components/CalendarWeekView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

const prickle = (id: string, start: string, end: string): Prickle => ({
  id,
  host: "Host",
  start_time: start,
  end_time: end,
  prickle_type: `Type ${id}`,
  attendance_count: 0,
});

function renderView(prickles: Prickle[], timezone = "UTC", secondary: string | null = ORG_TIMEZONE) {
  return render(
    <SecondaryTimezoneProvider zone={secondary}>
      <CalendarWeekView prickles={prickles} weekStartDate={{ year: 2026, month: 5, day: 1 }} userTimezonePreference={timezone} mode="member" />
    </SecondaryTimezoneProvider>
  );
}

describe("CalendarWeekView card time", () => {
  it("has the full time and a compact one (like the hour column's), switched by the calendar's width", () => {
    renderView([prickle("am", "2026-06-02T02:00:00Z", "2026-06-02T03:00:00Z"), prickle("pm", "2026-06-02T14:30:00Z", "2026-06-02T15:30:00Z")]);

    const am = screen.getByText("2:00 AM (Mon 10:00 PM ET)");
    expect(am).toHaveClass("hidden", "@pair:inline");
    expect(screen.getByText("2:00A")).toHaveClass("@pair:hidden");
    expect(am.parentElement).toHaveClass("text-[10px]", "@pair:text-xs");

    expect(screen.getByText("2:30 PM (10:30 AM ET)")).toHaveClass("hidden", "@pair:inline");
    expect(screen.getByText("2:30P")).toHaveClass("@pair:hidden");
  });

  it("adds nothing without a secondary zone", () => {
    renderView([prickle("am", "2026-06-02T14:00:00Z", "2026-06-02T15:00:00Z")], "UTC", null);
    expect(screen.getByText("2:00 PM")).toHaveClass("hidden", "@pair:inline");
  });

  it("adds nothing for a viewer already in the secondary zone", () => {
    renderView([prickle("am", "2026-06-02T14:00:00Z", "2026-06-02T15:00:00Z")], ORG_TIMEZONE);
    expect(screen.getByText("10:00 AM")).toHaveClass("hidden", "@pair:inline");
  });
});

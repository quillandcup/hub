// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "UTC") }));
vi.mock("@/components/CalendarWeekView", () => ({
  default: ({ weekStartDate }: { weekStartDate: { year: number; month: number; day: number } }) => (
    <div data-testid="week">{`${weekStartDate.year}-${weekStartDate.month + 1}-${weekStartDate.day}`}</div>
  ),
}));

import CalendarPage from "@/app/(admin)/admin/calendar/page";

async function renderWeek(week?: string) {
  await renderServerPage(CalendarPage, { searchParams: Promise.resolve(week ? { week } : {}) });
}

describe("admin calendar page default week", () => {
  beforeEach(() => {
    resetServerPageMocks();
    useFakeSupabase({ prickles: { data: [] } });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("opens on the current week on a Monday", async () => {
    vi.setSystemTime(new Date("2026-10-19T16:00:00Z"));
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-10-18");
  });

  it("opens on the current week on a Sunday", async () => {
    vi.setSystemTime(new Date("2026-10-18T16:00:00Z"));
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-10-18");
  });

  it("?week= overrides the default and snaps to Sunday", async () => {
    vi.setSystemTime(new Date("2026-10-19T16:00:00Z"));
    await renderWeek("2026-10-08");
    expect(screen.getByTestId("week").textContent).toBe("2026-10-4");
  });

  it("uses the Eastern day, not the host's: Saturday 23:30 Eastern is still last week", async () => {
    vi.setSystemTime(new Date("2026-10-18T03:30:00Z")); // Sat Oct 17, 23:30 EDT
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-10-11");
    expect(screen.getByText(/Week of 10\/11\/2026/)).toBeTruthy();
  });

  it("starts the new week at Eastern midnight on Sunday", async () => {
    vi.setSystemTime(new Date("2026-10-18T04:30:00Z")); // Sun Oct 18, 00:30 EDT
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-10-18");
  });

  it("handles the week of the fall-back change", async () => {
    vi.setSystemTime(new Date("2026-11-03T16:00:00Z"));
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-11-1");
    expect(screen.getByText(/Week of 11\/1\/2026/)).toBeTruthy();
  });
});

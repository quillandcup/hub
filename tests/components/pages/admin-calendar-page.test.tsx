// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";

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
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-10-18");
  });

  it("opens on the current week on a Sunday", async () => {
    vi.setSystemTime(new Date(2026, 9, 18, 12));
    await renderWeek();
    expect(screen.getByTestId("week").textContent).toBe("2026-10-18");
  });

  it("?week= overrides the default and snaps to Sunday", async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    await renderWeek("2026-10-08");
    expect(screen.getByTestId("week").textContent).toBe("2026-10-4");
  });
});

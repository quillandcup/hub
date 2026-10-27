// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { ADMIN_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));

const requireAdminPage = vi.fn(async () => {});
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
const previews = vi.fn(async (_userId: string): Promise<string[]> => ["events"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => previews(id) }));
vi.mock("@/app/(admin)/admin/events/calendar/CalendarEventsClient", () => ({ default: () => <div data-testid="calendar-list" /> }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import CalendarEventsPage from "@/app/(admin)/admin/events/calendar/page";

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
  previews.mockResolvedValue(["events"]);
  signInAs(ADMIN_USER);
});

describe("admin calendar items page", () => {
  it("checks for an admin, then shows the list under a way back to Events", async () => {
    await renderServerPage(CalendarEventsPage, {});

    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByTestId("calendar-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Events" })).toHaveAttribute("href", "/admin/events");
  });

  it("sends a signed-out visitor to sign in, and an admin without the events feature to the admin home", async () => {
    signInAs(null);
    await expectRedirect(CalendarEventsPage, {}, "/login");

    signInAs(ADMIN_USER);
    previews.mockResolvedValue([]);
    await expectRedirect(CalendarEventsPage, {}, "/admin");
  });
});

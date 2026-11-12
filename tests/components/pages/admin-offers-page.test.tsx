// @vitest-environment jsdom
/** The admin Kajabi Offers page: the coverage loader is mocked; the markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({}) }));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

const loadOfferCoverage = vi.fn();
vi.mock("@/lib/offer-coverage", async (orig) => ({
  ...(await orig<typeof import("@/lib/offer-coverage")>()),
  loadOfferCoverage: (...a: unknown[]) => loadOfferCoverage(...a),
}));

import AdminOffersPage from "@/app/(admin)/admin/offers/page";

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
  loadOfferCoverage.mockReset();
});

describe("/admin/offers", () => {
  it("checks the caller is an admin first", async () => {
    loadOfferCoverage.mockResolvedValue([]);
    await renderServerPage(AdminOffersPage, {});
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("shows each offer's state and linked resources, with counts", async () => {
    loadOfferCoverage.mockResolvedValue([
      { offerId: "o1", name: "Retreat", status: "active", resources: [
        { kind: "event", title: "Summer Retreat", href: "/admin/events/summer" },
        { kind: "course", title: "Retreat Course", href: "/admin/courses/c1" },
      ] },
      { offerId: "o2", name: "Orphan", status: null, resources: [] },
      { offerId: "o3", name: "180 Program", status: null, resources: [{ kind: "program", title: "180", href: "/admin/programs/p1" }] },
    ]);
    await renderServerPage(AdminOffersPage, {});

    expect(screen.getByText(/3 offers: 1 mapped, 1 not in the Hub yet, 1 with more than one resource/)).toBeInTheDocument();
    const multiple = screen.getByRole("row", { name: /Retreat/ });
    expect(within(multiple).getByText("More than one resource")).toBeInTheDocument();
    expect(within(multiple).getByRole("link", { name: "Summer Retreat" })).toHaveAttribute("href", "/admin/events/summer");
    const orphan = screen.getByRole("row", { name: /Orphan/ });
    expect(within(orphan).getByText("Not in the Hub yet")).toBeInTheDocument();
    expect(within(orphan).getByText("None")).toBeInTheDocument();
    const mapped = screen.getByRole("row", { name: /180 Program/ });
    expect(within(mapped).getByText("Mapped")).toBeInTheDocument();
    expect(within(mapped).getByRole("link", { name: "180" })).toHaveAttribute("href", "/admin/programs/p1");
  });
});

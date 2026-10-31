// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
const features = vi.fn(async (_userId: string): Promise<string[]> => ["hedgieversaries"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => features(id) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
// The table shows what the page hands it.
vi.mock("@/app/(admin)/admin/hedgieversaries/HedgieversariesTable", () => ({
  default: ({ rows }: { rows: { id: string; name: string; legalName: string; totalActiveMonths: number; hiatusWindows: unknown[] }[] }) => (
    <pre data-testid="rows">{JSON.stringify(rows.map((r) => [r.id, r.name, r.legalName, r.totalActiveMonths, r.hiatusWindows.length]))}</pre>
  ),
}));

import HedgieversariesPage from "@/app/(admin)/admin/hedgieversaries/page";

const member = (n: number, extra: object = {}) => ({
  id: `mbr_AAAAAAAAAAA${n}`,
  name: `Member ${n} Example`,
  email: `member${n}@example.test`,
  status: "active",
  firstJoinedAt: "2024-03-01",
  totalActiveMonths: 10,
  ...extra,
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  useFakeSupabase({});
  features.mockResolvedValue(["hedgieversaries"]);
});

describe("hedgieversaries page", () => {
  it("lists current members with a first-joined date, by display name, with their hiatus windows", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          member(1, { displayName: "Penny" }),
          member(2, { status: "on_hiatus" }),
          member(3, { status: "cancelled" }),
          member(4, { firstJoinedAt: null }),
        ] as never,
        memberHiatuses: [{ id: "mhh_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA2", start_date: "2026-01-01", end_date: null, reason: null, created_at: "2026-01-01T00:00:00Z" }] as never,
      })
    );

    await renderServerPage(HedgieversariesPage, {});

    expect(JSON.parse(screen.getByTestId("rows").textContent!)).toEqual([
      ["mbr_AAAAAAAAAAA1", "Penny", "Member 1 Example", 10, 0],
      ["mbr_AAAAAAAAAAA2", "Member 2 Example", "Member 2 Example", 10, 1],
    ]);
  });

  it("sends an admin without the preview to /admin, and a signed-out visitor to /login", async () => {
    features.mockResolvedValue([]);
    await expectRedirect(HedgieversariesPage, {}, "/admin");

    signInAs(null);
    await expectRedirect(HedgieversariesPage, {}, "/login");
  });
});

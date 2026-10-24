// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
// Members come from their repository, in memory here.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
// Client components show what the pages hand them.
vi.mock("@/app/(admin)/admin/segments/SegmentsClient", () => ({
  default: ({ allMembers }: { allMembers: unknown[] }) => <pre data-testid="segments">{JSON.stringify(allMembers)}</pre>,
}));
vi.mock("@/app/(admin)/admin/hygiene/ambiguous-names/AmbiguousNamesResolver", () => ({
  default: ({ entries }: { entries: unknown[] }) => <pre data-testid="entries">{JSON.stringify(entries)}</pre>,
}));

vi.mock("@/app/(admin)/admin/hygiene/merge-fix/MergeFixClient", () => ({
  default: ({ duplicateGroups }: { duplicateGroups: { members: Record<string, unknown>[] }[] }) => (
    <pre data-testid="groups">{JSON.stringify(duplicateGroups.map((g) => g.members.map((m) => ({ id: m.id, stripe: m.stripe_customer_id, active: m.stripe_active }))))}</pre>
  ),
}));

import SegmentsPage from "@/app/(admin)/admin/segments/page";
import MergeFixPage from "@/app/(admin)/admin/hygiene/merge-fix/page";
import MissingMemberDataPage from "@/app/(admin)/admin/hygiene/missing-member-data/page";
import AmbiguousNamesPage from "@/app/(admin)/admin/hygiene/ambiguous-names/page";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", userId: "user-secret", staffRole: "admin" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test", displayName: "Penny" };
const BEA = { id: "mbr_AAAAAAAAAAA3", name: "Bea Example", email: "bea@example.test" };

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA, FERN, BEA] }));
});

describe("segments page", () => {
  it("hands the picker every member by name, with only the fields it shows", async () => {
    useFakeSupabase({});

    await renderServerPage(SegmentsPage, {});

    const shown = JSON.parse(screen.getByTestId("segments").textContent!);
    expect(shown.map((m: { name: string }) => m.name)).toEqual(["Ada Example", "Bea Example", "Fern Example"]);
    expect(shown[0]).toEqual({ id: ADA.id, name: ADA.name, email: ADA.email }); // no auth user id, role or pen name
  });
});

describe("ambiguous Zoom names page", () => {
  it("groups the unresolved names and names each candidate member", async () => {
    useFakeSupabase({
      ambiguous_zoom_names: {
        data: [
          { zoom_name: "Sam", candidate_member_ids: [ADA.id, FERN.id], occurrence_count: 2, last_seen_at: "2026-10-01T00:00:00Z" },
          { zoom_name: "Sam", candidate_member_ids: [BEA.id, "mbr_ZZZZZZZZZZZZ"], occurrence_count: 3, last_seen_at: "2026-10-05T00:00:00Z" },
        ],
      },
    });

    await renderServerPage(AmbiguousNamesPage, {});

    const entries = JSON.parse(screen.getByTestId("entries").textContent!);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ zoomName: "Sam", occurrenceCount: 5, lastSeenAt: "2026-10-05T00:00:00Z" });
    // Candidates that no longer exist are left out; the rest are id, name and email only.
    expect(entries[0].candidates.map((c: { id: string }) => c.id).sort()).toEqual([ADA.id, FERN.id, BEA.id].sort());
    expect(entries[0].candidates.find((c: { id: string }) => c.id === FERN.id)).toEqual({ id: FERN.id, name: FERN.name, email: FERN.email });
  });
});

describe("merge and fix page", () => {
  it("finds members sharing an email and carries their Stripe customer and subscription standing", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAB1", name: "Wren Holloway", email: "wren@example.test", stripeCustomerId: "cus_1" },
          { id: "mbr_AAAAAAAAAAB2", name: "Wren H", email: "wren@example.test" },
          BEA,
        ],
      }),
    );
    useFakeSupabase({ "bronze.stripe_subscriptions": { data: [{ stripe_customer_id: "cus_1" }] } });

    await renderServerPage(MergeFixPage, {});

    const groups = JSON.parse(screen.getByTestId("groups").textContent!);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(expect.arrayContaining([{ id: "mbr_AAAAAAAAAAB1", stripe: "cus_1", active: true }, { id: "mbr_AAAAAAAAAAB2", stripe: null, active: false }]));
  });
});

describe("missing member data page", () => {
  it("lists active members with no Stripe customer, by name", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { ...FERN, stripeCustomerId: "cus_fern" },
          { ...BEA, kajabiId: "kaj-bea" },
          { ...ADA, status: "cancelled" },
          { id: "mbr_AAAAAAAAAAB3", name: "Zed Example", email: "zed@example.test" },
        ],
      }),
    );
    useFakeSupabase({});

    await renderServerPage(MissingMemberDataPage, {});

    expect(screen.getByText("Bea Example")).toBeInTheDocument();
    expect(screen.getByText("Zed Example")).toBeInTheDocument();
    expect(screen.queryByText("Fern Example")).not.toBeInTheDocument(); // has a Stripe customer
    expect(screen.queryByText("Ada Example")).not.toBeInTheDocument(); // not active
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/app/(admin)/admin/hygiene/members-without-slack/MemberSlackSearchForm", () => ({
  default: ({ unmatchedMembers }: { unmatchedMembers: unknown[] }) => (
    <pre data-testid="unmatched">{JSON.stringify(unmatchedMembers)}</pre>
  ),
}));

import ExternalConflictsPage from "@/app/(admin)/admin/hygiene/external-conflicts/page";
import MembersWithoutSlackPage from "@/app/(admin)/admin/hygiene/members-without-slack/page";

beforeEach(() => {
  resetServerPageMocks();
});

describe("external conflicts page", () => {
  it("labels a member with the display name and the legal name when they differ", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", displayName: "Ada E" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bea Example", email: "bea@example.test" },
        ],
      }),
    );
    useFakeSupabase({
      "bronze.kajabi_contacts": {
        data: [
          { kajabi_contact_id: "k1", email: "ada@example.test", name: "Ada" },
          { kajabi_contact_id: "k2", email: "ada@example.test", name: "Ada" },
          { kajabi_contact_id: "k3", email: "bea@example.test", name: "Bea" },
          { kajabi_contact_id: "k4", email: "bea@example.test", name: "Bea" },
        ],
      },
    });

    await renderServerPage(ExternalConflictsPage, {});

    expect(screen.getByRole("link", { name: "Ada E (Ada Example)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bea Example" })).toBeInTheDocument();
  });
});

describe("members without slack page", () => {
  it("passes each unmatched active member's display name to the form", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", displayName: "Ada E" }],
      }),
    );
    useFakeSupabase({});

    await renderServerPage(MembersWithoutSlackPage, {});

    const shown = JSON.parse(screen.getByTestId("unmatched").textContent!);
    expect(shown).toEqual([expect.objectContaining({ name: "Ada Example", displayName: "Ada E" })]);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { requirePermission } from "@/lib/admin-auth";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requirePermission: vi.fn(async () => undefined) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import TemporaryEmailsPage from "@/app/(admin)/admin/hygiene/temporary-emails/page";

beforeEach(() => {
  resetServerPageMocks();
});

describe("temporary emails page", () => {
  it("lists active members with a temporary-mail email or alias, by display name, and says which address matched", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@mailinator.com", displayName: "Ada E" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bea Example", email: "bea@example.com" },
          { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.com" },
        ],
        emailAliases: [
          { id: "ea2", memberId: "mbr_AAAAAAAAAAA2", alias_email: "bea2@mailinator.com", canonical_email: "bea@example.com", active: true },
          { id: "ea3", memberId: "mbr_AAAAAAAAAAA3", alias_email: "cy2@mailinator.com", canonical_email: "cy@example.com", active: false },
        ],
      }),
    );

    await renderServerPage(TemporaryEmailsPage, {});

    expect(requirePermission).toHaveBeenCalled();
    const ada = screen.getByRole("link", { name: "Ada E (Ada Example)" });
    expect(ada).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1");
    expect(screen.getByText("ada@mailinator.com")).toBeInTheDocument();
    expect(screen.getByText("(primary email)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bea Example" })).toBeInTheDocument();
    expect(screen.getByText(/bea2@mailinator\.com/)).toBeInTheDocument();
    expect(screen.getByText("(email alias)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cy Example" })).not.toBeInTheDocument(); // an inactive alias is not a current address
  });

  it("says so when none match", async () => {
    repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com" }] }));

    await renderServerPage(TemporaryEmailsPage, {});

    expect(screen.getByText(/No temporary-mail addresses/)).toBeInTheDocument();
  });
});

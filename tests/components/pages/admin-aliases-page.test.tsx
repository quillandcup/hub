// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
// The table is a client component with its own tests; print what the page hands it.
vi.mock("@/app/(admin)/admin/data/aliases/AliasesTable", () => ({
  default: ({ rows }: { rows: { member: { name: string }; aliases: { alias: string }[] }[] }) => (
    <ul aria-label="members with aliases">
      {rows.map((r) => (
        <li key={r.member.name}>{`${r.member.name}: ${r.aliases.map((a) => a.alias).join(", ")}`}</li>
      ))}
    </ul>
  ),
}));

import AliasListPage from "@/app/(admin)/admin/data/aliases/page";

const alias = (id: string, member: string, text: string) => ({ id, member_id: member, alias: text, source: "zoom", active: true });

beforeEach(() => {
  resetServerPageMocks();
});

describe("name aliases page", () => {
  it("groups every alias under its member, members by name, and counts them", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Zed Example", email: "zed@example.test" },
          { id: "mbr_AAAAAAAAAAA2", name: "Ada Example", email: "ada@example.test" },
        ],
        nameAliases: [
          alias("nal_1", "mbr_AAAAAAAAAAA1", "Zed E"),
          alias("nal_2", "mbr_AAAAAAAAAAA2", "Ada B"),
          alias("nal_3", "mbr_AAAAAAAAAAA2", "Ada A"),
          alias("nal_4", "mbr_ZZZZZZZZZZZZ", "Orphan"), // no member: left out
        ],
      })
    );

    await renderServerPage(AliasListPage, {});

    expect(screen.getByText(/3 aliases/)).toBeInTheDocument();
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Ada Example: Ada A, Ada B", "Zed Example: Zed E"]);
  });

  it("says so when there are none", async () => {
    repos = createInMemoryRepos();

    await renderServerPage(AliasListPage, {});

    expect(screen.getByText(/No aliases configured yet/)).toBeInTheDocument();
  });
});

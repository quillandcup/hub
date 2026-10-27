// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: async () => undefined }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/data/prickle-types/PrickleTypesTable", () => ({
  default: ({ rows }: { rows: { name: string; default_host_name: string | null }[] }) => (
    <pre data-testid="rows">{JSON.stringify(rows.map((r) => [r.name, r.default_host_name]))}</pre>
  ),
}));
vi.mock("@/app/(admin)/admin/data/prickle-types/[id]/edit/EditPrickleTypeForm", () => ({
  default: (props: { members: unknown[]; defaultHostName: string | null }) => (
    <pre data-testid="form">{JSON.stringify({ members: props.members.length, defaultHostName: props.defaultHostName })}</pre>
  ),
}));

import PrickleTypesPage from "@/app/(admin)/admin/data/prickle-types/page";
import EditPrickleTypePage from "@/app/(admin)/admin/data/prickle-types/[id]/edit/page";

const type = (id: string, name: string, default_host_id: string | null) => ({
  id, name, normalized_name: name.toLowerCase(), description: null, purpose: "work", solo_task_friendly: false,
  listed_in_events: false, announced_publicly: false, guests_allowed: false, default_host_id, summary_aliases: [],
  names_guest_speaker: false,
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER);
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" },
        { id: "mbr_AAAAAAAAAAA2", name: "Grace Example", status: "cancelled" },
      ],
    }),
  );
});

describe("prickle types list page", () => {
  it("looks up each type's default host by name", async () => {
    useFakeSupabase({ prickle_types: { data: [type("t1", "Educational", "mbr_AAAAAAAAAAA1"), type("t2", "Heads Down", null)] } });

    await renderServerPage(PrickleTypesPage, {});

    expect(JSON.parse(screen.getByTestId("rows").textContent!)).toEqual([["Educational", "Ada Example"], ["Heads Down", null]]);
  });
});

describe("prickle type edit page", () => {
  it("hands the form the active members and the default host's name", async () => {
    useFakeSupabase({ prickle_types: { data: type("t1", "Educational", "mbr_AAAAAAAAAAA1") } });

    await renderServerPage(EditPrickleTypePage, { params: Promise.resolve({ id: "t1" }) });

    expect(JSON.parse(screen.getByTestId("form").textContent!)).toEqual({ members: 1, defaultHostName: "Ada Example" });
  });

  it("still names a default host who is no longer active", async () => {
    useFakeSupabase({ prickle_types: { data: type("t1", "Educational", "mbr_AAAAAAAAAAA2") } });

    await renderServerPage(EditPrickleTypePage, { params: Promise.resolve({ id: "t1" }) });

    expect(JSON.parse(screen.getByTestId("form").textContent!)).toEqual({ members: 1, defaultHostName: "Grace Example" });
  });

  it("sends a visitor who isn't signed in to log in", async () => {
    signInAs(null);
    useFakeSupabase({ prickle_types: { data: type("t1", "Educational", null) } });

    await expectRedirect(EditPrickleTypePage, { params: Promise.resolve({ id: "t1" }) }, "/login");
  });
});

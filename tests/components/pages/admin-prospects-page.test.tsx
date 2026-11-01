// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/app/(admin)/admin/outreach/prospects/actions", () => ({ importProspects: vi.fn(), reviewProspect: vi.fn() }));

// Roles and prospects come from their repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import ProspectsPage from "@/app/(admin)/admin/outreach/prospects/page";

const prospect = {
  id: "prsp_AAAAAAAAAAA1",
  platform: "instagram" as const,
  handle: "ada.example",
  source: "paste",
  sourceNote: null,
  bio: "writer",
  followerCount: null,
  externalUrl: null,
  rejectReason: null,
  assessment: null,
  assessedAt: null,
  reviewedAt: null,
  hashtags: [],
  fitReasons: [],
  fitScore: 50,
  status: "new" as const,
  createdAt: "2097-01-01T00:00:00Z",
};

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset({
    userProfiles: [
      { id: ADMIN_USER.id, email: ADMIN_USER.email ?? "", role: "admin" },
      { id: MEMBER_USER.id, email: MEMBER_USER.email ?? "", role: "member" },
    ],
    prospects: [prospect],
  });
});

describe("/admin/outreach/prospects", () => {
  it("lists prospects for an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(ProspectsPage, {});

    expect(screen.getByRole("heading", { name: /Prospects/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "@ada.example" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to login and a member to no-access", async () => {
    signInAs(null);
    await expectRedirect(ProspectsPage, {}, "/login");

    signInAs(MEMBER_USER, null);
    await expectRedirect(ProspectsPage, {}, "/no-access");
  });
});

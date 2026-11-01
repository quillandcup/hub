// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  ADMIN_USER,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  ROLE_PROFILES,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));

// Roles and everything the page lists come from the repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import OutreachPage from "@/app/(admin)/admin/outreach/page";

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset({ userProfiles: ROLE_PROFILES });
});

describe("/admin/outreach", () => {
  it("shows the empty state when no leads carry the tag", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(OutreachPage, {});

    expect(screen.getByRole("heading", { name: /Outreach/ })).toBeInTheDocument();
    expect(screen.getByText(/yet\./)).toBeInTheDocument();
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(OutreachPage, {}, "/no-access");
  });
});

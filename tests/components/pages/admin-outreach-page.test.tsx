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
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => <button>Show change history</button> }));

// Roles and everything the page lists come from the repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import OutreachPage from "@/app/(admin)/admin/outreach/page";

const SPECIALIST = { id: "user-conversion-specialist", email: "cs@example.test" };
const COMMUNITY_MANAGER = { id: "user-community-manager", email: "cm@example.test" };

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset({
    userProfiles: [
      ...ROLE_PROFILES,
      { id: SPECIALIST.id, email: SPECIALIST.email, role: "conversion_specialist" },
      { id: COMMUNITY_MANAGER.id, email: COMMUNITY_MANAGER.email, role: "community_manager" },
    ],
  });
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

  it("opens for a conversion specialist, who is not offered the change history", async () => {
    signInAs(SPECIALIST, null);
    await renderServerPage(OutreachPage, {});

    expect(screen.getByRole("heading", { name: /Outreach/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show change history" })).not.toBeInTheDocument();
  });

  it("offers the change history to an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(OutreachPage, {});

    expect(screen.getByRole("button", { name: "Show change history" })).toBeInTheDocument();
  });

  it("sends a community manager to /no-access", async () => {
    signInAs(COMMUNITY_MANAGER, null);
    await expectRedirect(OutreachPage, {}, "/no-access");
  });
});

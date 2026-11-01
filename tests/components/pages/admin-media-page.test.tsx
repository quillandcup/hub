// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, MEMBER_USER, ROLE_PROFILES, expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/app/(admin)/admin/media/MediaLibraryClient", () => ({ default: () => <div data-testid="library" /> }));

// Roles and everything the page lists come from the repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import MediaPage from "@/app/(admin)/admin/media/page";

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset({ userProfiles: ROLE_PROFILES });
});

describe("admin media page", () => {
  it("shows the library to an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(MediaPage, {});
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByTestId("library")).toBeInTheDocument();
  });

  it("sends a member to /no-access and a signed-out visitor to /login", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(MediaPage, {}, "/no-access");
    signInAs(null);
    await expectRedirect(MediaPage, {}, "/login");
  });
});

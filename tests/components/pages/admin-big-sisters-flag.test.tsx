// @vitest-environment jsdom
/** The admin Big Sisters page is behind the big_sisters feature preview. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  ADMIN_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// Everything the page lists comes from the repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

let features: string[] = [];
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: async () => features }));

vi.mock("@/lib/arrivals", () => ({ getArrivals: async () => [] }));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => <div /> }));
vi.mock("@/app/(admin)/admin/mentorship/MatchesPanel", () => ({ default: () => <div data-testid="matches" /> }));
vi.mock("@/app/(admin)/admin/mentorship/EffectivenessPanel", () => ({ default: () => <div /> }));

import MentorshipPage from "@/app/(admin)/admin/mentorship/MentorshipPage";

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER, null);
  dataset = new InMemoryDataset();
});

describe("admin Big Sisters page", () => {
  it("sends an admin without the big_sisters preview back to /admin", async () => {
    features = ["work_queue"];
    await expectRedirect(MentorshipPage, { tab: "matches" as const }, "/admin");
  });

  it("sends a signed-out visitor to /login", async () => {
    signInAs(null);
    features = ["big_sisters"];
    await expectRedirect(MentorshipPage, { tab: "matches" as const }, "/login");
  });

  it("shows the page with the preview on", async () => {
    features = ["big_sisters"];
    await renderServerPage(MentorshipPage, { tab: "matches" as const });
    expect(screen.getByRole("heading", { name: "Big Sisters" })).toBeInTheDocument();
    expect(screen.getByTestId("matches")).toBeInTheDocument();
  });
});

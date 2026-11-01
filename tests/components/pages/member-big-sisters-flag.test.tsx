// @vitest-environment jsdom
/** The member Big Sisters page is behind the big_sisters feature preview: the viewer's own, or the
 * sudo'd member's in sudo. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// Everything the page lists comes from the repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

let flagOn = false;
const effectiveMemberHasFeature = vi.fn(async () => flagOn);
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: async () => [],
  effectiveMemberHasFeature: (...args: unknown[]) => (effectiveMemberHasFeature as (...a: unknown[]) => Promise<boolean>)(...args),
}));
vi.mock("@/lib/member-slack-links", () => ({ getSlackDmLinksForMembers: async () => new Map() }));
vi.mock("@/lib/my-mentorship", () => ({ getMyMentorships: async () => ({ bigSister: null, mentees: [] }) }));
vi.mock("@/app/(member)/big-sisters/VolunteerCard", () => ({ default: () => <div data-testid="volunteer-card" /> }));

import BigSistersPage from "@/app/(member)/big-sisters/page";

beforeEach(() => {
  resetServerPageMocks();
  effectiveMemberHasFeature.mockClear();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  dataset = new InMemoryDataset({
    members: [{ id: MEMBER_IDENTITY.memberId, name: MEMBER_IDENTITY.memberName, firstJoinedAt: "2024-01-01", mostRecentJoinedAt: "2024-01-01" }],
  });
});

describe("member Big Sisters page", () => {
  it("sends a member without the preview to the dashboard", async () => {
    flagOn = false;
    await expectRedirect(BigSistersPage, {}, "/dashboard");
  });

  it("checks the flag for the effective member, so sudo shows what they would see", async () => {
    flagOn = false;
    await expectRedirect(BigSistersPage, {}, "/dashboard");
    expect(effectiveMemberHasFeature).toHaveBeenCalledWith("big_sisters", MEMBER_IDENTITY, []);
  });

  it("shows the page with the preview on", async () => {
    flagOn = true;
    await renderServerPage(BigSistersPage, {});
    expect(screen.getByRole("heading", { name: "Big Sisters" })).toBeInTheDocument();
    expect(screen.getByTestId("volunteer-card")).toBeInTheDocument();
  });
});

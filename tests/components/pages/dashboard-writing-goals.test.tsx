// @vitest-environment jsdom
// The dashboard's Writing Goals card shows each project's title once, with that project's starred goals under it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { MEMBER_IDENTITY, MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// What the page reads from the repositories comes from this dataset, in memory.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "browser" }));
const m = vi.hoisted(() => ({ starred: [] as unknown[] }));
vi.mock("@/app/(member)/projects/actions", () => ({ getStarredGoals: async () => m.starred, getUnloggedRecentPrickles: async () => [] }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ loadDismissedCheckinIds: async () => new Set() }));
vi.mock("@/lib/upcoming-prickles", () => ({ getRankedUpcomingPrickles: async () => [] }));
vi.mock("@/app/(member)/prickles/checkin-actions", () => ({ getMyCheckins: async () => ({}) }));
vi.mock("@/lib/my-mentorship", () => ({ getMyMentorships: async () => ({ bigSister: null, mentees: [] }) }));
vi.mock("@/lib/member-slack-links", () => ({ getSlackDmLinksForMembers: async () => [] }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: async () => [], effectiveMemberHasFeature: async () => false }));
vi.mock("@/components/member/BigSisterCards", () => ({ default: () => null }));
vi.mock("@/components/UpcomingPrickleRow", () => ({ default: () => null }));
vi.mock("@/components/writing/UnloggedPricklesCard", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: ({ goal }: { goal: { title: string } }) => <p data-testid="goal">{goal.title}</p> }));

vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: async () => null }));
vi.mock("@/lib/courses/member", () => ({ loadContinueWatching: async () => null }));

import DashboardPage from "@/app/(member)/dashboard/page";

const goal = (id: string, title: string, projectId: string | null, projectTitle: string) => ({
  id, title, projectId, projectTitle, measure: "words", isStarred: true, kind: "target", status: "active",
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  dataset = new InMemoryDataset();
  m.starred = [];
});

describe("dashboard Writing Goals", () => {
  it("shows a project's title once for its two goals, linked to the project", async () => {
    m.starred = [goal("g1", "Daily words", "wprj_1", "Lantern Draft"), goal("g2", "Finish draft", "wprj_1", "Lantern Draft")];
    await renderServerPage(DashboardPage, undefined as never);
    const links = screen.getAllByRole("link", { name: "Lantern Draft" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/projects/wprj_1");
    expect(screen.getAllByTestId("goal").map((g) => g.textContent)).toEqual(["Daily words", "Finish draft"]);
  });

  it("shows each project's title once, in the order the goals come", async () => {
    m.starred = [goal("g1", "A1", "wprj_2", "Essays"), goal("g2", "A2", "wprj_2", "Essays"), goal("g3", "B1", "wprj_1", "Novel")];
    await renderServerPage(DashboardPage, undefined as never);
    const card = screen.getByRole("heading", { name: "Writing Goals" }).parentElement!;
    expect(within(card).getAllByRole("link").map((l) => l.textContent)).toEqual(["Essays", "Novel"]);
    expect(screen.getAllByTestId("goal").map((g) => g.textContent)).toEqual(["A1", "A2", "B1"]);
  });

  it("names a goal with no project without linking to a page that doesn't exist", async () => {
    m.starred = [goal("g1", "Loose goal", null, "Untitled project")];
    await renderServerPage(DashboardPage, undefined as never);
    expect(screen.getByText("Untitled project")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Untitled project" })).toBeNull();
    expect(document.querySelector('a[href="/projects/null"]')).toBeNull();
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MEMBER_IDENTITY, MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "browser" }));
vi.mock("@/app/(member)/projects/actions", () => ({ getStarredGoals: async () => [], getUnloggedRecentPrickles: async () => [] }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ loadDismissedCheckinIds: async () => new Set() }));
vi.mock("@/lib/upcoming-prickles", () => ({ getRankedUpcomingPrickles: async () => [] }));
vi.mock("@/app/(member)/prickles/checkin-actions", () => ({ getMyCheckins: async () => ({}) }));
vi.mock("@/lib/my-mentorship", () => ({ getMyMentorships: async () => ({ bigSister: null, mentees: [] }) }));
vi.mock("@/lib/member-slack-links", () => ({ getSlackDmLinksForMembers: async () => [] }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: async () => [], effectiveMemberHasFeature: async () => false }));
vi.mock("@/components/member/BigSisterCards", () => ({ default: () => null }));
vi.mock("@/components/UpcomingPrickleRow", () => ({ default: () => null }));
vi.mock("@/components/writing/UnloggedPricklesCard", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));

const getCoursesCaller = vi.fn();
const loadContinueWatching = vi.fn();
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: () => getCoursesCaller() }));
vi.mock("@/lib/courses/member", () => ({ loadContinueWatching: (...a: unknown[]) => loadContinueWatching(...a) }));

import DashboardPage from "@/app/(member)/dashboard/page";

const scope = { memberId: MEMBER_IDENTITY.memberId, isAdminActing: false };
const item = {
  course: { id: "c1", slug: "memoir", title: "Memoir Basics" },
  lesson: { id: "l2", title: "Scenes", thumbnail_url: null },
  progress: { available: 4, completed: 1, continueLessonId: "l2", allDone: false },
  positionSeconds: 90,
  href: "/courses/memoir/lessons/l2",
};

beforeEach(() => {
  resetServerPageMocks();
  getCoursesCaller.mockReset();
  loadContinueWatching.mockReset();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase();
});

describe("dashboard Continue watching", () => {
  it("links the card straight to the lesson, for the effective member", async () => {
    getCoursesCaller.mockResolvedValue({ scope });
    loadContinueWatching.mockResolvedValue(item);
    await renderServerPage(DashboardPage, undefined as never);
    const link = screen.getByRole("link", { name: /Scenes/ });
    expect(link).toHaveAttribute("href", "/courses/memoir/lessons/l2");
    expect(screen.getByText("Memoir Basics")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(loadContinueWatching).toHaveBeenCalledWith(expect.anything(), scope);
  });

  it("shows nothing when the courses flag is off or nothing is in progress", async () => {
    getCoursesCaller.mockResolvedValue(null);
    await renderServerPage(DashboardPage, undefined as never);
    expect(screen.queryByText("Continue watching")).toBeNull();
    expect(loadContinueWatching).not.toHaveBeenCalled();

    getCoursesCaller.mockResolvedValue({ scope });
    loadContinueWatching.mockResolvedValue(null);
    document.body.innerHTML = "";
    await renderServerPage(DashboardPage, undefined as never);
    expect(screen.queryByText("Continue watching")).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * The links on the Streaks page that only render with a real sister streak: the shared prickles
 * under a streak. The streak computation is stubbed to one established streak so the page renders
 * that list; what is checked is that each link goes where it should and is a named control (for
 * usage analytics).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MEMBER_IDENTITY, MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ from: () => ({ select: () => ({ data: [] }) }) }) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "UTC" }));
vi.mock("@/lib/member-slack-links", () => ({ getSlackDmLinksForMembers: async () => new Map() }));

const SISTER = {
  memberId: "member-gale",
  memberName: "Gale Prickleton",
  currentStreak: 3,
  longestStreak: 4,
  sharedPrickleIds: ["prickle-1"],
};
vi.mock("@/lib/streaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/streaks")>()),
  computeSisterStreaks: () => [SISTER],
}));

import StreaksPage from "@/app/(member)/streaks/page";

/** The member's own data, with Gale's directory photo (null: no photo). */
function seed(galePhoto: string | null) {
  useFakeSupabase({
    members: { data: { photo_url: null } },
    // This member's own attendance, with the prickle's details for the shared-prickle link. The
    // co-attendance query (it excludes the member) has nothing to add: the streak is stubbed.
    prickle_attendance: (q: FakeQuery) =>
      q.calls.some((c) => c.method === "neq")
        ? { data: [] }
        : { data: [{ prickle_id: "prickle-1", join_time: "2026-11-02T15:00:00Z", prickles: { start_time: "2026-11-02T15:00:00Z", prickle_types: { name: "Morning Writing" } } }] },
    member_directory: { data: [{ id: "member-gale", photo_url: galePhoto }] },
  });
}

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  seed(null);
});

describe("Streaks: a sister streak's shared prickles", () => {
  it("links each to its prickle, as a named control", async () => {
    await renderServerPage(StreaksPage, {});
    expect(screen.getByText("Gale Prickleton")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Morning Writing/ });
    expect(link).toHaveAttribute("href", "/prickles/prickle-1");
    expect(link).toHaveAttribute("data-track", "streaks-open-prickle");
  });
});

describe("Streaks: a sister streak's avatar", () => {
  it("shows their photo next to the name, hidden from screen readers (the name is beside it)", async () => {
    seed("https://img.example/gale.jpg");
    await renderServerPage(StreaksPage, {});

    const photo = document.querySelector('img[src="https://img.example/gale.jpg"]')!;
    expect(photo).toHaveAttribute("width", "24");
    expect(photo.closest("[aria-hidden=true]")).not.toBeNull();
    expect(screen.getAllByText("Gale Prickleton")).toHaveLength(1);
  });

  it("falls back to their initials when they have no photo", async () => {
    await renderServerPage(StreaksPage, {});

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("GP")).toBeInTheDocument();
  });
});

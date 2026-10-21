// @vitest-environment jsdom
/**
 * The links on the Streaks and Network pages that only render with a real sister streak: the shared
 * prickles under a streak, and the people drawn on the Network graph. The streak computation is
 * stubbed to one established streak so the pages render those lists; what is checked is that each
 * link goes where it should and is a named control (for usage analytics).
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
import NetworkPage from "@/app/(member)/network/page";

const names = () => new Set(Array.from(document.querySelectorAll("[data-track]")).map((el) => el.getAttribute("data-track")));

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase({
    members: { data: { photo_url: null } },
    // This member's own attendance, with the prickle's details for the shared-prickle link. The
    // co-attendance query (it excludes the member) has nothing to add: the streak is stubbed.
    prickle_attendance: (q: FakeQuery) =>
      q.calls.some((c) => c.method === "neq")
        ? { data: [] }
        : { data: [{ prickle_id: "prickle-1", join_time: "2026-11-02T15:00:00Z", prickles: { start_time: "2026-11-02T15:00:00Z", prickle_types: { name: "Morning Writing" } } }] },
    member_directory: { data: [{ id: "member-gale", photo_url: null }] },
  });
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

describe("Network: the connections drawn around you", () => {
  it("links each connection to their profile, as a named control", async () => {
    await renderServerPage(NetworkPage, {});
    const link = document.querySelector('a[href="/members/member-gale"][data-track="network-open-connection"]');
    expect(link).not.toBeNull();
    expect(names().has("network-open-connection")).toBe(true);
  });
});

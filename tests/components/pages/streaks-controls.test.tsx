// @vitest-environment jsdom
/**
 * The links on the Streaks page that only render with a real sister streak: the shared prickles
 * under a streak. The streak computation is stubbed to one established streak so the page renders
 * that list; what is checked is that each link goes where it should and is a named control (for
 * usage analytics).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MEMBER_IDENTITY, MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ from: () => ({ select: () => ({ data: [] }) }) }) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "UTC" }));
// Attendance comes from its repository: the member's one attendance, with the prickle's type for the shared-prickle link.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let SISTER = {
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

/** Gale's photo in the member directory (null: no photo); a test sets it before rendering. */
let galePhoto: string | null = null;

beforeEach(() => {
  galePhoto = null;
  SISTER = { ...SISTER, currentStreak: 3 };
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  repos = createInMemoryRepos(
    new InMemoryDataset({
      prickleTypes: [{ id: "ptyp-1", name: "Morning Writing", normalizedName: "morning-writing", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
      prickles: [
        { id: "prickle-1", typeId: "ptyp-1", hostId: null, title: null, startTime: "2026-11-02T15:00:00Z", endTime: "2026-11-02T16:00:00Z", source: "calendar", calendarEventId: null },
      ],
      attendance: [{ id: "att-1", memberId: MEMBER_IDENTITY.memberId, prickleId: "prickle-1", joinTime: "2026-11-02T15:00:00Z", leaveTime: "2026-11-02T16:00:00Z" }],
    }),
  );
  useFakeSupabase({
    members: { data: { photo_url: null } },
    member_directory: () => ({ data: [{ id: "member-gale", photo_url: galePhoto }] }),
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

describe("Streaks: a sister streak's avatar", () => {
  it("shows their photo next to the name, hidden from screen readers (the name is beside it)", async () => {
    galePhoto = "https://img.example/gale.jpg";
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

describe("Streaks: a sister streak's flame", () => {
  /** The row's name, avatar and flame slot, in the order they appear. */
  function rowParts() {
    const name = screen.getByText("Gale Prickleton");
    // Avatar and name share one link, inside the hover-card wrapper that follows the flame slot.
    const link = name.parentElement!;
    const hoverWrapper = link.parentElement!;
    const group = hoverWrapper.parentElement!;
    const flameSlot = group.firstElementChild!;
    const avatar = link.firstElementChild!;
    return { name, link, hoverWrapper, group, flameSlot, avatar };
  }

  it("sits left of the avatar, which is next to the name", async () => {
    await renderServerPage(StreaksPage, {});
    const { name, hoverWrapper, group, flameSlot, avatar } = rowParts();

    expect(flameSlot).toHaveTextContent("🔥");
    expect(avatar).toHaveTextContent("GP");
    expect(avatar.nextElementSibling).toBe(name);
    expect(flameSlot.nextElementSibling).toBe(hoverWrapper);
    expect(group.firstElementChild).toBe(flameSlot);
  });

  it("leaves an empty slot for an extinguished streak, so avatars stay aligned", async () => {
    SISTER = { ...SISTER, currentStreak: 0 };
    await renderServerPage(StreaksPage, {});
    const { flameSlot, avatar } = rowParts();

    expect(flameSlot).toBeEmptyDOMElement();
    expect(flameSlot).toHaveClass("w-5");
    expect(avatar).toHaveTextContent("GP");
  });
});

// @vitest-environment jsdom
/**
 * Page wiring for the member profile (app/(member)/members/[id]/page.tsx): the public Hosting card
 * (MemberHostingCard, itself covered in MemberHostingCard.test.tsx), and the Books and Awards
 * sections. Hosted-prickle records go through the page's real computePublicHostingSummary, so
 * records that include late and no-show hosting must still never surface punctuality.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeTables,
} from "@/tests/helpers/server-page";
import type { HostedPrickleRecord } from "@/lib/hosting-stats";
import type { HostedScheduleSlot } from "@/lib/prickle-schedule";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

vi.mock("@/app/(member)/projects/actions", () => ({
  getProfileWriting: vi.fn(async () => ({ projects: [], goals: [] })),
}));
vi.mock("@/lib/badges", () => ({
  getMemberBadges: vi.fn(async () => []),
  getAttendedPrickleCount: vi.fn(async () => 17),
}));
vi.mock("@/lib/hosted-prickles", () => ({ fetchHostedPrickleRecords: vi.fn(async () => []) }));
vi.mock("@/lib/prickle-schedule", () => ({ getMemberHostingSchedule: vi.fn(async () => []) }));

import MemberProfilePage from "@/app/(member)/members/[id]/page";
import { fetchHostedPrickleRecords } from "@/lib/hosted-prickles";
import { getMemberHostingSchedule } from "@/lib/prickle-schedule";
import { getProfileWriting, type ProfileWritingGoal } from "@/app/(member)/projects/actions";

const PROFILE_ID = "member-hazel";

const HAZEL = {
  id: PROFILE_ID,
  name: "Hazel Burrowes",
  display_name: null,
  joined_at: "2023-01-10",
  first_joined_at: "2023-01-10",
  most_recent_joined_at: "2023-01-10",
  total_active_months: 30,
  photo_url: null,
  bio: null,
  instagram_url: null,
  facebook_url: null,
  twitter_url: null,
};

// On time, >5 min late, and a no-show -- the page must not expose any of that distinction.
const HOSTED: HostedPrickleRecord[] = [
  {
    prickleId: "p1",
    typeName: "Progress Prickle",
    startTime: "2025-02-04T15:00:00Z",
    earliestJoinTime: "2025-02-04T14:58:00Z",
    attendeeCount: 6,
  },
  {
    prickleId: "p2",
    typeName: "Progress Prickle",
    startTime: "2025-02-11T15:00:00Z",
    earliestJoinTime: "2025-02-11T15:20:00Z",
    attendeeCount: 4,
  },
  { prickleId: "p3", typeName: "Sprint", startTime: "2025-02-18T15:00:00Z", earliestJoinTime: null, attendeeCount: 2 },
];

const SLOT: HostedScheduleSlot = {
  seriesKey: "t1:2-10:00",
  sortKey: "2-10:00",
  dayOfWeek: "Tuesday",
  timeLabel: "10:00 AM EDT",
  typeName: "Progress Prickle",
  nextOccurrenceId: "prickle-next",
  nextOccurrenceStart: "2026-09-29T14:00:00.000Z",
  upcomingCount: 5,
};

const params = { params: Promise.resolve({ id: PROFILE_ID }) };

function tables(extra: FakeTables = {}): FakeTables {
  return { member_directory: { data: HAZEL }, ...extra };
}

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase(tables());
  vi.mocked(fetchHostedPrickleRecords).mockResolvedValue([]);
  vi.mocked(getMemberHostingSchedule).mockResolvedValue([]);
  vi.mocked(getProfileWriting).mockResolvedValue({ projects: [], goals: [] });
});

function hostingCard(): HTMLElement | null {
  return screen.queryByRole("heading", { name: "Hosting" })?.parentElement ?? null;
}

describe("member profile page: Hosting card", () => {
  it("renders the card with hosting stats and the upcoming schedule", async () => {
    vi.mocked(fetchHostedPrickleRecords).mockResolvedValue(HOSTED);
    vi.mocked(getMemberHostingSchedule).mockResolvedValue([SLOT]);
    await renderServerPage(MemberProfilePage, params);

    const card = hostingCard();
    expect(card).not.toBeNull();
    expect(within(card!).getByText("prickles hosted").previousElementSibling).toHaveTextContent("3");
    expect(within(card!).queryByText(/per session/)).not.toBeInTheDocument();
    expect(within(card!).getByText("Join Hazel at")).toBeInTheDocument();
    expect(within(card!).getByRole("link", { name: /Tuesdays · 10:00 AM EDT/ })).toHaveAttribute(
      "href",
      "/prickles/prickle-next"
    );
    // The viewer's timezone drives the schedule.
    expect(fetchHostedPrickleRecords).toHaveBeenCalledWith(
      expect.anything(),
      PROFILE_ID,
      expect.objectContaining({ includeAttendeeCounts: true })
    );
    expect(getMemberHostingSchedule).toHaveBeenCalledWith(
      expect.anything(),
      PROFILE_ID,
      expect.any(Date),
      "America/New_York",
      expect.any(Number)
    );
  });

  it("renders the card for a host with only upcoming prickles", async () => {
    vi.mocked(getMemberHostingSchedule).mockResolvedValue([SLOT]);
    await renderServerPage(MemberProfilePage, params);
    expect(hostingCard()).not.toBeNull();
    expect(screen.getByText("Join Hazel at")).toBeInTheDocument();
  });

  it("omits the card for a member who has neither hosted nor has anything upcoming", async () => {
    await renderServerPage(MemberProfilePage, params);
    expect(screen.getByRole("heading", { level: 1, name: "Hazel Burrowes" })).toBeInTheDocument();
    expect(hostingCard()).toBeNull();
  });

  it("never shows host punctuality (on-time / late / no-show) on the profile", async () => {
    vi.mocked(fetchHostedPrickleRecords).mockResolvedValue(HOSTED);
    vi.mocked(getMemberHostingSchedule).mockResolvedValue([SLOT]);
    const { container } = await renderServerPage(MemberProfilePage, params);
    expect(hostingCard()).not.toBeNull();
    expect(container).not.toHaveTextContent(/on[- ]time|no[- ]show|punctual|\blate\b|show[- ]up|missed/i);
  });
});

describe("member profile page: header", () => {
  it("shows the member's last prickle instead of a Community Stats card", async () => {
    const supabase = useFakeSupabase(
      tables({ prickle_attendance: { data: [{ join_time: "2026-09-24T14:00:00Z" }] } })
    );
    await renderServerPage(MemberProfilePage, params);

    expect(screen.getByText(/^Last prickle/)).toHaveTextContent(/^Last prickle Sep 24(, 2026)?$/);
    expect(screen.queryByRole("heading", { name: "Community Stats" })).not.toBeInTheDocument();
    expect(screen.queryByText(/current streak/)).not.toBeInTheDocument();
    const lastQuery = supabase.queries.find(
      (q) => q.table === "prickle_attendance" && q.calls.some((c) => c.method === "limit")
    );
    expect(lastQuery?.calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["member_id", PROFILE_ID] },
        { method: "order", args: ["join_time", { ascending: false }] },
      ])
    );
  });

  it("omits the last-prickle line for a member who has never attended", async () => {
    await renderServerPage(MemberProfilePage, params);
    expect(screen.queryByText(/^Last prickle/)).not.toBeInTheDocument();
  });
});

describe("member profile page: Books and Awards", () => {
  it("renders Published Books and Awards when the member has them", async () => {
    useFakeSupabase(
      tables({
        member_books: {
          data: [
            {
              id: "book-1",
              title: "The Lantern Keeper",
              cover_url: null,
              purchase_url: "https://books.example.test/lantern",
              published_date: "2025-06-15",
            },
          ],
        },
        member_awards: {
          data: [
            {
              id: "award-1",
              award_name: "Golden Quill",
              category: "Debut Fiction",
              work_title: "The Lantern Keeper",
              award_date: "2026-03-01",
              url: null,
            },
          ],
        },
      })
    );
    await renderServerPage(MemberProfilePage, params);

    const books = screen.getByRole("heading", { name: "Published Books" }).parentElement!;
    expect(within(books).getByRole("link", { name: "The Lantern Keeper" })).toHaveAttribute(
      "href",
      "https://books.example.test/lantern"
    );
    expect(within(books).getByText("June 2025")).toBeInTheDocument();

    const awards = screen.getByRole("heading", { name: "Awards" }).parentElement!;
    expect(within(awards).getByText(/Golden Quill/)).toHaveTextContent("🏆 Golden Quill — Debut Fiction");
    expect(within(awards).getByText(/for “The Lantern Keeper”/)).toHaveTextContent("March 2026");
  });

  it("omits the Books and Awards sections when the member has neither", async () => {
    await renderServerPage(MemberProfilePage, params);
    expect(screen.queryByRole("heading", { name: "Published Books" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Awards" })).not.toBeInTheDocument();
  });
});

describe("member profile page: Writing Progress", () => {
  const GOAL: ProfileWritingGoal = {
    id: "goal-1",
    projectId: "project-2",
    projectTitle: "Safe in Sound",
    measure: "chapters",
    isStarred: false,
    title: "Finish Draft 3",
    description: "Get the manuscript ready for beta readers",
    showOnProfile: true,
    anchorLabel: null,
    kind: "target",
    targetAmount: 18,
    startDate: "2026-06-01",
    endDate: "2026-08-15",
    current: 18,
    percent: 100,
    parTarget: 18,
    onPace: true,
    status: "achieved",
  };

  it("shows opted-in projects and goals, with the goal's title, description and status", async () => {
    vi.mocked(getProfileWriting).mockResolvedValue({
      projects: [{ id: "project-1", title: "2626", headline: { measure: "words", total: 63338 } }],
      goals: [GOAL],
    });
    await renderServerPage(MemberProfilePage, params);

    expect(getProfileWriting).toHaveBeenCalledWith(PROFILE_ID);
    const card = screen.getByRole("heading", { name: "Writing Progress" }).parentElement!;
    expect(within(card).getByText("63,338")).toBeInTheDocument();
    expect(within(card).getByText("words on 2626")).toBeInTheDocument();
    expect(within(card).getByText("Safe in Sound")).toBeInTheDocument();
    expect(within(card).getByText("Finish Draft 3")).toBeInTheDocument();
    expect(within(card).getByText("Get the manuscript ready for beta readers")).toBeInTheDocument();
    expect(within(card).getByText("Achieved!")).toBeInTheDocument();
  });

  it("omits the section when nothing is opted in", async () => {
    await renderServerPage(MemberProfilePage, params);
    expect(screen.queryByRole("heading", { name: "Writing Progress" })).not.toBeInTheDocument();
  });
});

describe("member profile page: access", () => {
  it("redirects a user with no effective member identity to /admin", async () => {
    signInAs(ADMIN_USER, null);
    await expectRedirect(MemberProfilePage, params, "/admin");
  });
});

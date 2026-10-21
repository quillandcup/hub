// @vitest-environment jsdom
/** The staff watch-stats pages for a course and a lesson. The data loader is mocked; markup is real. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { computePlaySessions, computeVideoWatchStats } from "@/lib/courses/watch-stats";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const signThumbnailTokens = vi.fn();
vi.mock("@/lib/mux", () => ({ createMuxClient: () => ({}), signThumbnailTokens: (...a: unknown[]) => signThumbnailTokens(...a) }));

const loadCourseWatchStats = vi.fn();
vi.mock("@/lib/courses/watch-stats-data", () => ({ loadCourseWatchStats: (...a: unknown[]) => loadCourseWatchStats(...a) }));

import CourseWatchStatsPage from "@/app/(admin)/admin/courses/[id]/stats/page";
import LessonWatchStatsPage from "@/app/(admin)/admin/courses/[id]/stats/[lessonId]/page";

const KAJABI = "kaj-1";
const L1 = "00000000-0000-4000-a000-00000000a001";
const L2 = "00000000-0000-4000-a000-00000000a002";
const L3 = "00000000-0000-4000-a000-00000000a003";
const seg = (m: string, start: number, end: number, over: object = {}) => ({ memberId: m, sessionId: `s-${m}`, start, end, rate: 1, captions: null, visible: true, ...over });
const lesson = (id: string, title: string, over: object = {}) => ({ id, module_id: null, title, position: 1, state: "open", duration_seconds: 600, ...over });

const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const view = (m: string, startedAt: string, userAgent: string | null = null) => ({ memberId: m, sessionId: `s-${m}`, startedAt, userAgent });
// Three visits: a and b played, c only opened the lesson.
const segments = [seg("a", 0, 600, { startedAt: "2026-10-06T22:10:30Z" }), seg("b", 0, 300, { rate: 1.5, captions: "English", startedAt: "2026-10-05T20:24:30Z" }), seg("a", 100, 200, { startedAt: "2026-10-06T22:12:00Z" })];
const views = [view("a", "2026-10-06T22:10:00Z", WINDOWS_CHROME), view("b", "2026-10-05T20:24:00Z"), view("c", "2026-10-07T09:00:00Z")];
const stats = computeVideoWatchStats(segments, 600, views);
const NAMES: Record<string, string> = { a: "Fern Quillsby", b: "Bramble Hedgewick", c: "Moss Thistledown" };
// Only a's visit has a recorded place and IP (the access log had no located event before the others).
const LOCATIONS: Record<string, { place: string | null; ip: string | null }> = { a: { place: "Muncie, IN, US", ip: "203.0.113.7" } };
const sessions = computePlaySessions(segments, 600, views).map((x) => ({ ...x, memberName: NAMES[x.memberId], location: LOCATIONS[x.memberId] ?? null }));
const data = (over: object = {}) => ({
  course: { id: "c1", title: "The Ready Writer", slug: "the-ready-writer" },
  lessons: [
    { lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: "pb-1", stats, sessions },
    { lesson: lesson(L2, "Voice", { state: "coming_soon" }), videoId: "v2", playbackId: null, stats: null, sessions: [] },
    { lesson: lesson(L3, "Reading list"), videoId: null, playbackId: null, stats: null, sessions: [] },
  ],
  viewers: 2,
  watchedSeconds: 1000,
  staffExcluded: true,
  ...over,
});

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
  signInAs(ADMIN_USER, null);
  loadCourseWatchStats.mockReset();
  signThumbnailTokens.mockReset();
  signThumbnailTokens.mockImplementation(async (_mux: unknown, _id: string, times: number[]) => times.map((_, i) => `tok${i}`));
  loadCourseWatchStats.mockResolvedValue(data());
});

// A stat tile's value, found by its label (the same words also head table columns and chart labels).
const tile = (label: string) => screen.getAllByText(label).find((el) => el.nextElementSibling?.className.includes("text-3xl"))!.nextElementSibling;

const courseProps = (searchParams: object = {}) => ({ params: Promise.resolve({ id: KAJABI }), searchParams: Promise.resolve(searchParams) });
const lessonProps = (lessonId = L1, searchParams: object = {}) => ({ params: Promise.resolve({ id: KAJABI, lessonId }), searchParams: Promise.resolve(searchParams) });

describe("/admin/courses/[id]/stats", () => {
  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(CourseWatchStatsPage, courseProps(), "/no-access");
    expect(loadCourseWatchStats).not.toHaveBeenCalled();
  });

  it("lists lessons with a video, with their numbers, and leaves out lessons without one", async () => {
    await renderServerPage(CourseWatchStatsPage, courseProps());

    expect(screen.getByRole("heading", { level: 1, name: "Watch stats" })).toBeInTheDocument();
    expect(tile("Viewers")).toHaveTextContent("2");
    expect(tile("Time watched")).toHaveTextContent("0.3 h");
    expect(tile("Lessons watched")).toHaveTextContent("1 of 2");

    const row = screen.getByRole("link", { name: "Reader Expectations" }).closest("tr")!;
    expect(screen.getByRole("link", { name: "Reader Expectations" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats/${L1}`);
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("1 of 2")).toBeInTheDocument();
    expect(within(row).getByRole("img")).toBeInTheDocument();

    const unwatched = screen.getByRole("link", { name: "Voice" }).closest("tr")!;
    expect(within(unwatched).getByText("coming soon")).toBeInTheDocument();
    expect(within(unwatched).getByText("No views")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reading list" })).not.toBeInTheDocument();
  });

  it("leaves staff out by default and includes them with ?staff=1, keeping the choice on the lesson links", async () => {
    await renderServerPage(CourseWatchStatsPage, courseProps());
    expect(loadCourseWatchStats).toHaveBeenLastCalledWith(expect.anything(), KAJABI, { includeStaff: false });
    expect(screen.getByRole("link", { name: "Include staff" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats?staff=1`);
  });

  it("includes staff on request", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ staffExcluded: false }));
    await renderServerPage(CourseWatchStatsPage, courseProps({ staff: "1" }));
    expect(loadCourseWatchStats).toHaveBeenLastCalledWith(expect.anything(), KAJABI, { includeStaff: true });
    expect(screen.getByRole("link", { name: "Leave out staff" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats`);
    expect(screen.getByRole("link", { name: "Reader Expectations" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats/${L1}?staff=1`);
  });

  it("is a 404 for a course that isn't in the Hub", async () => {
    loadCourseWatchStats.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => CourseWatchStatsPage(courseProps()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("says so when no lesson has a video", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L3, "Reading list"), videoId: null, playbackId: null, stats: null, sessions: [] }] }));
    await renderServerPage(CourseWatchStatsPage, courseProps());
    expect(screen.getByText("No lesson of this course has a video yet.")).toBeInTheDocument();
  });
});

describe("/admin/courses/[id]/stats/[lessonId]", () => {
  beforeEach(() => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: "pb-1", stats, sessions }] }));
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(LessonWatchStatsPage, lessonProps(), "/no-access");
  });

  it("asks the loader for just this lesson, and shows the numbers, the engagement chart and how it was watched", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    expect(loadCourseWatchStats).toHaveBeenCalledWith(expect.anything(), KAJABI, { includeStaff: false, lessonId: L1, withSessions: true, sessionLimit: 20 });
    expect(screen.getByRole("heading", { level: 1, name: "Reader Expectations" })).toBeInTheDocument();
    expect(tile("Viewers")).toHaveTextContent("2");
    expect(screen.getByText("Average watched")).toBeInTheDocument();
    expect(tile("Watched 90%+")).toHaveTextContent("1 of 2");
    // 1000s played in all; member a replayed 100s of what they had already watched, and b's overlap with a is another person, not a rewatch.
    expect(tile("Rewatched")).toHaveTextContent("1:40");
    expect(screen.getByText("of 16:40 played")).toBeInTheDocument();
    // One panel: the frames and the three counts together, not a heatmap and a separate chart.
    expect(screen.getAllByRole("img", { name: /Engagement over the 10:00 video/ })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Heatmap" })).not.toBeInTheDocument();
    // One table view under the engagement panel, one under the over-time chart.
    expect(screen.getAllByText("Table view")).toHaveLength(2);
    expect(screen.getByText("1.5x")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View lesson" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${L1}`);
  });

  it("shows Kajabi's engagement and total plays, each with what it means", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    // a played all 600s (twice over 100-200), b played 300s, in two sessions: 1000 / (2 x 600).
    expect(tile("Engagement")).toHaveTextContent("83%");
    expect(tile("Total plays")).toHaveTextContent("2");
    expect(screen.getByText(/total watch time divided by \(total plays × video length\)/)).toBeInTheDocument();
    expect(screen.getByText(/one for each visit to the lesson with at least one stretch watched/)).toBeInTheDocument();
  });

  it("draws the heatmap over the video's frames, signing one still per slice at its middle moment", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    expect(screen.getByRole("heading", { name: "Engagement" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /times watched, plays and people by moment, drawn over its frames/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show video frames" })).toBeChecked();
    const [, playbackId, times] = signThumbnailTokens.mock.calls[0];
    expect(playbackId).toBe("pb-1");
    expect(times).toHaveLength(stats.buckets.length);
    expect(times[0]).toBeCloseTo(3);
    expect(times[times.length - 1]).toBeCloseTo(597);
  });

  it("keeps the engagement chart, on a plain panel, when the stills can't be signed or the video has no playback id", async () => {
    signThumbnailTokens.mockRejectedValue(new Error("Mux is down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(screen.getByText("Frame previews aren't available for this video.")).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith("Couldn't sign Mux thumbnail tokens:", "Mux is down");
    log.mockRestore();

    signThumbnailTokens.mockClear();
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: null, stats, sessions }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(signThumbnailTokens).not.toHaveBeenCalled();
  });

  it("keeps 'plays' (one per visit) apart from 'times watched' (passes over a moment), and says so", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    // Total plays is per visit; rewinding inside one is still one play.
    expect(screen.getByText(/rewinding or replaying within one visit is still one play/)).toBeInTheDocument();
    // The engagement panel names its three counts and how they nest.
    expect(screen.getByText("Times watched, rewatches included")).toBeInTheDocument();
    expect(screen.getByText("Plays (visits)")).toBeInTheDocument();
    expect(screen.getByText("People, each counted once")).toBeInTheDocument();
    expect(screen.getByText(/each stricter than the last/)).toBeInTheDocument();
  });

  it("never names Kajabi in the stats page's text", async () => {
    const { container } = await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(container.textContent).not.toMatch(/kajabi/i);
  });

  it("shows the play rate: the share of visits where the video was played", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    // Three visits (a, b and c opened the lesson), two of them played.
    expect(tile("Play rate")).toHaveTextContent("67%");
    expect(screen.getByText("2 of 3 visits")).toBeInTheDocument();
    expect(screen.getByText(/The percentage of visits to the lesson, where the video appeared, in which it was played/)).toBeInTheDocument();
  });

  it("lists the visits newest first, by member name, with a coverage bar and the device behind a click", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    const rows = screen.getAllByRole("listitem").filter((li) => li.querySelector("details"));
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Moss Thistledown", "Fern Quillsby", "Bramble Hedgewick"]);
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/admin/members/c");

    // c only opened the lesson: an empty bar. a covered all of it, on Windows.
    expect(within(rows[0]).getByRole("img")).toHaveAccessibleName("Covered 0% of the video: nothing played");
    expect(within(rows[0]).getByText("Not played")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("img")).toHaveAccessibleName("Covered 100% of the video: 0:00 to 10:00");
    expect(within(rows[1]).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Unknown device")).toBeInTheDocument();
    // Where it came from: the place and the raw IP for a, nothing recorded for the others.
    expect(within(rows[1]).getByText("Muncie, IN, US")).toBeInTheDocument();
    expect(within(rows[1]).getByText("203.0.113.7")).toBeInTheDocument();
    expect(within(rows[0]).getAllByText("Not recorded")).toHaveLength(2);
    expect(within(rows[1]).getByText(/October 6, 2026/)).toBeInTheDocument();
  });

  it("pages the visits: twenty at a time, with Load more asking for another page and keeping the staff choice", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ ...sessions[1], sessionId: `s-${i}`, memberName: `Member ${i}`, startedAt: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T10:00:00Z` }));
    // The loader is asked to place as many visits as the page shows.
    loadCourseWatchStats.mockResolvedValue(data({ staffExcluded: false, lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: "pb-1", stats, sessions: many }] }));

    await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { staff: "1" }));
    expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("details"))).toHaveLength(20);
    expect(screen.getByText("Showing 20 of 45")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats/${L1}?limit=40&staff=1`);
    expect(loadCourseWatchStats).toHaveBeenLastCalledWith(expect.anything(), KAJABI, { includeStaff: true, lessonId: L1, withSessions: true, sessionLimit: 20 });
  });

  it("shows more when asked, and offers nothing more once everything is shown", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ ...sessions[1], sessionId: `s-${i}`, memberName: `Member ${i}` }));
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: "pb-1", stats, sessions: many }] }));

    await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { limit: "60" }));
    expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("details"))).toHaveLength(45);
    expect(screen.queryByRole("link", { name: "Load more" })).not.toBeInTheDocument();
  });

  describe("over time", () => {
    // Pinned so the presets mean the same thing every day: Tuesday 20 October 2026, mid-afternoon in the organisation's timezone.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-20T19:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("charts total plays by day over the last 30 days by default, with the controls and what the metric means", async () => {
      await renderServerPage(LessonWatchStatsPage, lessonProps());

      expect(screen.getByRole("heading", { name: "Over time" })).toBeInTheDocument();
      expect(screen.getByLabelText("Metric")).toHaveValue("total_plays");
      expect(screen.getByLabelText("Range")).toHaveValue("30d");
      expect(screen.getByLabelText("By")).toHaveValue("day");
      expect(screen.getByLabelText("From")).toHaveValue("2026-09-21");
      expect(screen.getByLabelText("To")).toHaveValue("2026-10-20");
      // a and b played; c only opened the lesson.
      expect(screen.getByTestId("series-total")).toHaveTextContent("2");
      expect(screen.getByText(/Visits to the lesson in which the video was played at all/)).toBeInTheDocument();
      expect(screen.getByRole("img", { name: /Total plays by day, Sep 21 to Oct 20/ })).toBeInTheDocument();
    });

    it("offers the six metrics, the ranges and day, week and month", async () => {
      await renderServerPage(LessonWatchStatsPage, lessonProps());

      const options = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent);
      expect(options("Metric")).toEqual(["Total plays", "Unique plays", "Unique viewers", "Play rate", "Engagement rate", "Hours watched"]);
      expect(options("Range")).toEqual(["Today", "Last 7 days", "Last 30 days", "Last month", "This month", "Last quarter", "This quarter", "This year", "Last 12 months", "All time", "Custom range"]);
      expect(options("By")).toEqual(["Day", "Week", "Month"]);
    });

    it("shows the metric, range and grouping the link asks for", async () => {
      await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { metric: "play_rate", range: "this_month", by: "week" }));

      expect(screen.getByLabelText("Metric")).toHaveValue("play_rate");
      expect(screen.getByLabelText("Range")).toHaveValue("this_month");
      // Two of the three visits in October played the video.
      expect(screen.getByTestId("series-total")).toHaveTextContent("67%");
      // The definition is in the play rate tile and under the chart's total.
      expect(screen.getAllByText(/The percentage of visits to the lesson, where the video appeared, in which it was played/)).toHaveLength(2);
      expect(screen.getByRole("img", { name: /Play rate by week, Sep 27 to Oct 18/ })).toBeInTheDocument();
    });

    it("takes a custom range", async () => {
      await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { range: "custom", from: "2026-10-06", to: "2026-10-06" }));

      expect(screen.getByLabelText("From")).toHaveValue("2026-10-06");
      expect(screen.getByLabelText("To")).toHaveValue("2026-10-06");
      // Only a's visit began on the 6th (local time).
      expect(screen.getByTestId("series-total")).toHaveTextContent("1");
    });

    it("runs all time from the first recorded visit", async () => {
      await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { range: "all" }));
      expect(screen.getByLabelText("From")).toHaveValue("2026-10-05");
      expect(screen.getByTestId("series-total")).toHaveTextContent("2");
    });

    it("falls back to the defaults for a link it doesn't understand", async () => {
      await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { metric: "revenue", range: "forever", by: "year", from: "junk" }));
      expect(screen.getByLabelText("Metric")).toHaveValue("total_plays");
      expect(screen.getByLabelText("Range")).toHaveValue("30d");
    });

    it("keeps the staff choice when Apply is pressed, and only then", async () => {
      const { container } = await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { staff: "1" }));
      expect(container.querySelector("form input[name=staff]")).toHaveAttribute("value", "1");
      cleanup();

      const without = await renderServerPage(LessonWatchStatsPage, lessonProps());
      expect(without.container.querySelector("form input[name=staff]")).not.toBeInTheDocument();
    });

    it("keeps the chart's settings when loading more visits", async () => {
      const many = Array.from({ length: 45 }, (_, i) => ({ ...sessions[1], sessionId: `s-${i}`, memberName: `Member ${i}` }));
      loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: "pb-1", stats, sessions: many }] }));
      await renderServerPage(LessonWatchStatsPage, lessonProps(L1, { metric: "hours_watched", by: "week", range: "7d" }));

      expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats/${L1}?limit=40&metric=hours_watched&by=week&range=7d`);
    });

    it("has no chart when nobody has opened the video", async () => {
      loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Voice"), videoId: "v1", playbackId: "pb-1", stats: null, sessions: [] }] }));
      await renderServerPage(LessonWatchStatsPage, lessonProps());
      expect(screen.queryByRole("heading", { name: "Over time" })).not.toBeInTheDocument();
    });
  });

  it("says when the lesson was viewed but nobody played it", async () => {
    const viewedOnly = computeVideoWatchStats([], 600, [view("c", "2026-10-07T09:00:00Z")]);
    loadCourseWatchStats.mockResolvedValue(
      data({ lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", playbackId: "pb-1", stats: viewedOnly, sessions: computePlaySessions([], 600, [view("c", "2026-10-07T09:00:00Z")]).map((x) => ({ ...x, memberName: "Moss Thistledown", location: null })) }] }),
    );
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    expect(tile("Play rate")).toHaveTextContent("0%");
    expect(tile("Total plays")).toHaveTextContent("0");
    expect(screen.getByText("Not played")).toBeInTheDocument();
  });

  it("labels a preview lesson's link as a preview", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Voice", { state: "coming_soon" }), videoId: "v1", playbackId: "pb-1", stats, sessions }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(screen.getByRole("link", { name: "Preview lesson" })).toBeInTheDocument();
  });

  it("says when nobody has watched it, or when it has no video", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Voice"), videoId: "v1", playbackId: "pb-1", stats: null, sessions: [] }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(screen.getByText(/Nobody has watched this video yet \(staff viewing is left out\)/)).toBeInTheDocument();
  });

  it("says a lesson has no video", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L3, "Reading list"), videoId: null, playbackId: null, stats: null, sessions: [] }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps(L3));
    expect(screen.getByText("This lesson has no video.")).toBeInTheDocument();
  });

  it("is a 404 for an id that isn't a lesson id, or a lesson that isn't in the course", async () => {
    await expect(Promise.resolve().then(() => LessonWatchStatsPage(lessonProps("not-a-uuid")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [] }));
    await expect(Promise.resolve().then(() => LessonWatchStatsPage(lessonProps()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

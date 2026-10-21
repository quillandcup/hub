// @vitest-environment jsdom
/** The staff watch-stats pages for a course and a lesson. The data loader is mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { computeVideoWatchStats } from "@/lib/courses/watch-stats";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const loadCourseWatchStats = vi.fn();
vi.mock("@/lib/courses/watch-stats-data", () => ({ loadCourseWatchStats: (...a: unknown[]) => loadCourseWatchStats(...a) }));

import CourseWatchStatsPage from "@/app/(admin)/admin/courses/[id]/stats/page";
import LessonWatchStatsPage from "@/app/(admin)/admin/courses/[id]/stats/[lessonId]/page";

const KAJABI = "kaj-1";
const L1 = "00000000-0000-4000-a000-00000000a001";
const L2 = "00000000-0000-4000-a000-00000000a002";
const L3 = "00000000-0000-4000-a000-00000000a003";
const seg = (m: string, start: number, end: number, over: object = {}) => ({ memberId: m, start, end, rate: 1, captions: null, visible: true, ...over });
const lesson = (id: string, title: string, over: object = {}) => ({ id, module_id: null, title, position: 1, state: "open", duration_seconds: 600, ...over });

const stats = computeVideoWatchStats([seg("a", 0, 600), seg("b", 0, 300, { rate: 1.5, captions: "English" }), seg("a", 100, 200)], 600);
const data = (over: object = {}) => ({
  course: { id: "c1", title: "The Ready Writer", slug: "the-ready-writer" },
  lessons: [
    { lesson: lesson(L1, "Reader Expectations"), videoId: "v1", stats },
    { lesson: lesson(L2, "Voice", { state: "coming_soon" }), videoId: "v2", stats: null },
    { lesson: lesson(L3, "Reading list"), videoId: null, stats: null },
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
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L3, "Reading list"), videoId: null, stats: null }] }));
    await renderServerPage(CourseWatchStatsPage, courseProps());
    expect(screen.getByText("No lesson of this course has a video yet.")).toBeInTheDocument();
  });
});

describe("/admin/courses/[id]/stats/[lessonId]", () => {
  beforeEach(() => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Reader Expectations"), videoId: "v1", stats }] }));
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(LessonWatchStatsPage, lessonProps(), "/no-access");
  });

  it("asks the loader for just this lesson, and shows the numbers, the engagement chart and how it was watched", async () => {
    await renderServerPage(LessonWatchStatsPage, lessonProps());

    expect(loadCourseWatchStats).toHaveBeenCalledWith(expect.anything(), KAJABI, { includeStaff: false, lessonId: L1 });
    expect(screen.getByRole("heading", { level: 1, name: "Reader Expectations" })).toBeInTheDocument();
    expect(tile("Viewers")).toHaveTextContent("2");
    expect(screen.getByText("Average watched")).toBeInTheDocument();
    expect(tile("Watched 90%+")).toHaveTextContent("1 of 2");
    // 1000s played in all; member a replayed 100s of what they had already watched, and b's overlap with a is another person, not a rewatch.
    expect(tile("Rewatched")).toHaveTextContent("1:40");
    expect(screen.getByText("of 16:40 played")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Engagement over the 10:00 video/ })).toBeInTheDocument();
    expect(screen.getByText("Table view")).toBeInTheDocument();
    expect(screen.getByText("1.5x")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View lesson" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${L1}`);
  });

  it("labels a preview lesson's link as a preview", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Voice", { state: "coming_soon" }), videoId: "v1", stats }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(screen.getByRole("link", { name: "Preview lesson" })).toBeInTheDocument();
  });

  it("says when nobody has watched it, or when it has no video", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L1, "Voice"), videoId: "v1", stats: null }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps());
    expect(screen.getByText(/Nobody has watched this video yet \(staff viewing is left out\)/)).toBeInTheDocument();
  });

  it("says a lesson has no video", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [{ lesson: lesson(L3, "Reading list"), videoId: null, stats: null }] }));
    await renderServerPage(LessonWatchStatsPage, lessonProps(L3));
    expect(screen.getByText("This lesson has no video.")).toBeInTheDocument();
  });

  it("is a 404 for an id that isn't a lesson id, or a lesson that isn't in the course", async () => {
    await expect(Promise.resolve().then(() => LessonWatchStatsPage(lessonProps("not-a-uuid")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    loadCourseWatchStats.mockResolvedValue(data({ lessons: [] }));
    await expect(Promise.resolve().then(() => LessonWatchStatsPage(lessonProps()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

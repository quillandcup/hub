// @vitest-environment jsdom
/** A lesson's watch stats as a modal (the intercepting route under courses/[id]/@modal). The data loader is mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computePlaySessions, computeVideoWatchStats } from "@/lib/courses/watch-stats";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, routerMock, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/mux", () => ({ createMuxClient: () => ({}), signThumbnailTokens: async (_m: unknown, _id: string, times: number[]) => times.map((_, i) => `tok${i}`) }));

const loadCourseWatchStats = vi.fn();
vi.mock("@/lib/courses/watch-stats-data", () => ({ loadCourseWatchStats: (...a: unknown[]) => loadCourseWatchStats(...a) }));

import LessonWatchStatsModal from "@/app/(admin)/admin/courses/[id]/@modal/(.)stats/[lessonId]/page";
import CloseModal from "@/app/(admin)/admin/courses/[id]/@modal/[...catchAll]/page";
import NoModal from "@/app/(admin)/admin/courses/[id]/@modal/default";
import CourseLayout from "@/app/(admin)/admin/courses/[id]/layout";

const KAJABI = "kaj-1";
const L1 = "les_AAAAAAAAAAA1";
const seg = (m: string, start: number, end: number) => ({ memberId: m, sessionId: `s-${m}`, start, end, rate: 1, captions: null, visible: true, startedAt: "2026-10-06T22:10:30Z" });
const view = (m: string) => ({ memberId: m, sessionId: `s-${m}`, startedAt: "2026-10-06T22:10:00Z", userAgent: null });
const segments = [seg("a", 0, 600), seg("b", 0, 300)];
const views = [view("a"), view("b"), view("c")];
const stats = computeVideoWatchStats(segments, 600, views);
const sessions = computePlaySessions(segments, 600, views).map((x) => ({ ...x, memberName: `Member ${x.memberId}`, location: null }));
const lesson = (over: object = {}) => ({ id: L1, module_id: null, title: "Reader Expectations", position: 1, state: "open", duration_seconds: 600, ...over });
const data = (entry: object, over: object = {}) => ({
  course: { id: "c1", title: "The Ready Writer", slug: "the-ready-writer" },
  lessons: [{ lesson: lesson(), videoId: "v1", playbackId: "pb-1", stats, sessions, ...entry }],
  viewers: 2,
  watchedSeconds: 900,
  staffExcluded: true,
  ...over,
});

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};
const props = (lessonId = L1, searchParams: object = {}) => ({ params: Promise.resolve({ id: KAJABI, lessonId }), searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
  signInAs(ADMIN_USER, null);
  loadCourseWatchStats.mockReset();
  loadCourseWatchStats.mockResolvedValue(data({}));
});

describe("lesson watch stats modal", () => {
  it("sends a member to /no-access and loads nothing", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(LessonWatchStatsModal, props(), "/no-access");
    expect(loadCourseWatchStats).not.toHaveBeenCalled();
  });

  it("is a dialog titled with the lesson, with the numbers in a strip and the engagement tab first", async () => {
    await renderServerPage(LessonWatchStatsModal, props());

    const dialog = screen.getByRole("dialog", { name: "Reader Expectations" });
    expect(loadCourseWatchStats).toHaveBeenCalledWith(expect.anything(), KAJABI, { includeStaff: false, lessonId: L1, withSessions: true, sessionLimit: 20 });
    // Seven numbers, each carrying what it means (on hover, and for a screen reader).
    for (const label of ["Engagement", "Total plays", "Play rate", "Viewers", "Average watched", "Watched 90%+", "Rewatched"]) {
      const tileEl = within(dialog).getAllByText(label).find((el) => el.nextElementSibling?.className.includes("text-2xl"))!.parentElement!;
      expect(tileEl).toHaveAttribute("title");
    }
    expect(within(dialog).getByText("Viewers").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: "Engagement" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: /times watched, plays and people by moment/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How it was watched" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Over time" })).not.toBeInTheDocument();
  });

  it("switches to the chart, whose Apply replaces the URL and keeps the staff choice", async () => {
    loadCourseWatchStats.mockResolvedValue(data({}, { staffExcluded: false }));
    const user = userEvent.setup();
    await renderServerPage(LessonWatchStatsModal, props(L1, { staff: "1" }));

    await user.click(screen.getByRole("tab", { name: "Over time" }));
    expect(screen.getByRole("heading", { name: "Over time" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("By"), "week");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const url = routerMock.replace.mock.calls[0][0] as string;
    expect(url).toMatch(new RegExp(`^/admin/courses/${KAJABI}/stats/${L1}\\?`));
    expect(url).toContain("staff=1");
    expect(url).toContain("by=week");
  });

  it("lists the visits on the Views tab, with Load more keeping the staff choice", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ ...sessions[1], sessionId: `s-${i}`, memberName: `Visitor ${i}` }));
    loadCourseWatchStats.mockResolvedValue(data({ sessions: many }, { staffExcluded: false }));
    const user = userEvent.setup();
    await renderServerPage(LessonWatchStatsModal, props(L1, { staff: "1" }));

    await user.click(screen.getByRole("tab", { name: "Views" }));
    expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("details"))).toHaveLength(20);
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats/${L1}?limit=40&staff=1`);
  });

  it("toggles staff in place, and links to the lesson", async () => {
    await renderServerPage(LessonWatchStatsModal, props());
    expect(screen.getByRole("link", { name: "Include staff" })).toHaveAttribute("href", `/admin/courses/${KAJABI}/stats/${L1}?staff=1`);
    expect(screen.getByRole("link", { name: "View lesson" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${L1}`);
  });

  it("closes back to the page it was opened over", async () => {
    const user = userEvent.setup();
    await renderServerPage(LessonWatchStatsModal, props());

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(routerMock.back).toHaveBeenCalledTimes(2);
  });

  it("says when nobody has watched it, or when it has no video, without tabs", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ stats: null, sessions: [] }));
    await renderServerPage(LessonWatchStatsModal, props());
    expect(screen.getByText(/Nobody has watched this video yet \(staff viewing is left out\)/)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("says a lesson has no video", async () => {
    loadCourseWatchStats.mockResolvedValue(data({ videoId: null, playbackId: null, stats: null, sessions: [] }));
    await renderServerPage(LessonWatchStatsModal, props());
    expect(screen.getByText("This lesson has no video.")).toBeInTheDocument();
  });

  it("is a 404 for an id that isn't a lesson id, or a lesson that isn't in the course", async () => {
    await expect(Promise.resolve().then(() => LessonWatchStatsModal(props("not-a-uuid")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    loadCourseWatchStats.mockResolvedValue(data({}, { lessons: [] }));
    await expect(Promise.resolve().then(() => LessonWatchStatsModal(props()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("the course's modal slot", () => {
  it("shows nothing by default and for any other route, which closes the modal", async () => {
    expect(NoModal()).toBeNull();
    await expect(CloseModal()).resolves.toBeNull();
    signInAs(MEMBER_USER, null);
    await expectRedirect(CloseModal, {}, "/no-access");
  });

  it("renders the page and the modal slot together", () => {
    render(CourseLayout({ children: <p>page</p>, modal: <p>modal</p> }));
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.getByText("modal")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
/** The member courses pages: list, course outline, lesson. Data loaders are mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { SUPPORT_EMAIL } from "@/lib/config";
import { buildOutline, courseProgress, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";
import { expectRedirect, renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const caller = { userId: "u", identity: { memberId: "m1", isSudo: false }, scope: { memberId: "m1", isAdminActing: false } };
vi.mock("@/lib/courses/caller", () => ({ requireCoursesPage: async () => caller }));

const loadCourseList = vi.fn();
const loadCourseView = vi.fn();
const loadLessonView = vi.fn();
vi.mock("@/lib/courses/member", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/courses/member")>()),
  loadCourseList: (...a: unknown[]) => loadCourseList(...a),
  loadCourseView: (...a: unknown[]) => loadCourseView(...a),
  loadLessonView: (...a: unknown[]) => loadLessonView(...a),
}));

const signPlaybackTokens = vi.fn();
vi.mock("@/lib/mux", () => ({ createMuxClient: () => ({}), signPlaybackTokens: (...a: unknown[]) => signPlaybackTokens(...a) }));
vi.mock("@/app/(member)/courses/LessonPlayer", () => ({
  default: ({ playbackId }: { playbackId: string }) => <div data-testid="player">{playbackId}</div>,
}));
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn(async () => ({})) }));

import CoursesPage from "@/app/(member)/courses/page";
import CoursePage from "@/app/(member)/courses/[slug]/page";
import LessonPage from "@/app/(member)/courses/[slug]/lessons/[lessonId]/page";

const LESSON_A = "11111111-1111-4111-8111-111111111111";
const LESSON_B = "22222222-2222-4222-8222-222222222222";
const LESSON_SOON = "33333333-3333-4333-8333-333333333333";

const mod: OutlineModule = { id: "mod", parent_id: null, title: "Month 1", position: 1, state: "open" };
const lesson = (id: string, title: string, position: number, state: "open" | "coming_soon" = "open"): OutlineLesson => ({
  id,
  module_id: "mod",
  title,
  position,
  state,
  duration_seconds: id === LESSON_A ? 545 : null,
});
const outline = buildOutline([mod], [lesson(LESSON_A, "Welcome", 1), lesson(LESSON_B, "Voice", 2), lesson(LESSON_SOON, "Revision", 3, "coming_soon")]);
const course = { id: "c1", slug: "the-ready-writer", title: "The Ready Writer", description: "Write a book." };

beforeEach(() => {
  resetServerPageMocks();
  loadCourseList.mockReset();
  loadCourseView.mockReset();
  loadLessonView.mockReset();
  signPlaybackTokens.mockReset();
  caller.identity.isSudo = false;
});

describe("/courses", () => {
  it("says so when there are no courses", async () => {
    loadCourseList.mockResolvedValue([]);
    await renderServerPage(CoursesPage, {});
    expect(screen.getByText(/don't have any courses yet/)).toBeInTheDocument();
  });

  it("shows progress against available lessons and a Continue link to the next lesson", async () => {
    const completed = new Set([LESSON_A]);
    loadCourseList.mockResolvedValue([{ course, access: { kind: "open", endsAt: null }, progress: courseProgress(outline, completed) }]);
    await renderServerPage(CoursesPage, {});

    expect(screen.getByText("1 of 2 available lessons done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "The Ready Writer progress" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_B}`);
  });

  it("offers Start before anything is done, and marks an ended course with a link to its outline", async () => {
    loadCourseList.mockResolvedValue([
      { course, access: { kind: "open", endsAt: null }, progress: courseProgress(outline, new Set()) },
      { course: { ...course, id: "c2", slug: "old", title: "Old Course" }, access: { kind: "ended", endsAt: "2026-01-15T12:00:00Z" }, progress: courseProgress(outline, new Set([LESSON_A])) },
    ]);
    await renderServerPage(CoursesPage, {});

    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
    expect(screen.getByText("Access ended January 15, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute("href", "/courses/old");
  });
});

describe("/courses for a pre-order", () => {
  it("says when it opens instead of offering to start it", async () => {
    loadCourseList.mockResolvedValue([{ course, access: { kind: "upcoming", startsAt: "2026-11-02T05:00:00Z" }, progress: courseProgress(outline, new Set()) }]);
    await renderServerPage(CoursesPage, {});

    expect(screen.getByText("Opens November 2, 2026")).toBeInTheDocument();
    expect(screen.getByText(/The course opens on November 2, 2026, and your access starts then/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("/courses/[slug]", () => {
  const params = (slug = "the-ready-writer") => ({ params: Promise.resolve({ slug }) });

  it("is a 404 for a course that doesn't exist", async () => {
    loadCourseView.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => CoursePage(params("nope")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("tells a pre-order buyer when the course opens, and shows none of it", async () => {
    loadCourseView.mockResolvedValue({ course, access: { kind: "upcoming", startsAt: "2026-11-02T05:00:00Z" }, outline: null, completed: new Set(), progress: null });
    await renderServerPage(CoursePage, params());

    expect(screen.getByText("You're in. This course opens on November 2, 2026.")).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this course yet.")).not.toBeInTheDocument();
  });

  it("explains how to get access instead of a 404, and shows none of the course", async () => {
    loadCourseView.mockResolvedValue({ course, access: { kind: "none" }, outline: null, completed: new Set(), progress: null });
    await renderServerPage(CoursePage, params());

    expect(screen.getByText("You don't have access to this course yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("shows the outline with checkmarks, durations and Coming soon, and a Continue button", async () => {
    const completed = new Set([LESSON_A]);
    loadCourseView.mockResolvedValue({ course, access: { kind: "open", endsAt: null }, outline, completed, progress: courseProgress(outline, completed) });
    await renderServerPage(CoursePage, params());

    const nav = screen.getByRole("navigation", { name: "Course outline" });
    expect(within(nav).getByRole("link", { name: /Welcome.*completed.*9:05/ })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
    expect(within(nav).getByRole("link", { name: /Voice/ })).toBeInTheDocument();
    expect(within(nav).getByText("Revision")).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Revision/ })).not.toBeInTheDocument();
    expect(within(nav).getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_B}`);
  });

  it("closes the lessons when access has ended, but keeps the progress", async () => {
    const completed = new Set([LESSON_A]);
    loadCourseView.mockResolvedValue({
      course,
      access: { kind: "ended", endsAt: "2026-01-15T12:00:00Z" },
      outline,
      completed,
      progress: courseProgress(outline, completed),
    });
    await renderServerPage(CoursePage, params());

    expect(screen.getByRole("status")).toHaveTextContent("Your access ended on January 15, 2026");
    expect(screen.getByText("1 of 2 available lessons done")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Course outline" })).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
  });
});

describe("/courses/[slug]/lessons/[lessonId]", () => {
  const params = (lessonId = LESSON_B) => ({ params: Promise.resolve({ slug: "the-ready-writer", lessonId }) });
  const ok = (over: Record<string, unknown> = {}) => ({
    kind: "ok",
    view: { course, access: { kind: "open", endsAt: null }, outline, completed: new Set([LESSON_A]), progress: courseProgress(outline, new Set([LESSON_A])) },
    lesson: { ...lesson(LESSON_B, "Voice", 2), body_html: "<h2>Find your voice</h2><p>Write.</p>" },
    neighbors: { previous: lesson(LESSON_A, "Welcome", 1), next: null },
    completed: false,
    video: null,
    ...over,
  });

  it("is a 404 for an id that isn't a lesson id or isn't found", async () => {
    await expect(Promise.resolve().then(() => LessonPage(params("not-a-uuid")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    loadLessonView.mockResolvedValue({ kind: "not_found" });
    await expect(Promise.resolve().then(() => LessonPage(params()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("sends a lesson that can't be opened back to the course page, which says why", async () => {
    for (const kind of ["no_access", "coming_soon"]) {
      loadLessonView.mockResolvedValue({ kind, view: {} });
      await expectRedirect(LessonPage, params(), "/courses/the-ready-writer");
    }
  });

  it("shows the lesson text, previous/next, the outline and mark complete", async () => {
    loadLessonView.mockResolvedValue(ok());
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("heading", { level: 1, name: "Voice" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Find your voice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Previous" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Course outline" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeEnabled();
    expect(screen.queryByTestId("player")).not.toBeInTheDocument();
  });

  it("plays a ready video with signed tokens minted for it", async () => {
    signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
    loadLessonView.mockResolvedValue(ok({ video: { status: "ready", playbackId: "pb-1" } }));
    await renderServerPage(LessonPage, params());

    expect(screen.getByTestId("player")).toHaveTextContent("pb-1");
    expect(signPlaybackTokens).toHaveBeenCalledWith({}, "pb-1");
  });

  it("says a video is still being prepared, and mints nothing for it", async () => {
    loadLessonView.mockResolvedValue(ok({ video: { status: "preparing", playbackId: null } }));
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("status")).toHaveTextContent("still being prepared");
    expect(signPlaybackTokens).not.toHaveBeenCalled();
  });

  it("falls back to a message when playback tokens can't be minted", async () => {
    signPlaybackTokens.mockRejectedValue(new Error("no key"));
    loadLessonView.mockResolvedValue(ok({ video: { status: "ready", playbackId: "pb-1" } }));
    await renderServerPage(LessonPage, params());

    expect(screen.queryByTestId("player")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("disables mark complete in sudo, which is read-only", async () => {
    caller.identity.isSudo = true;
    loadLessonView.mockResolvedValue(ok());
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("button", { name: "Mark complete" })).toBeDisabled();
  });
});

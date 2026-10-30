// @vitest-environment jsdom
/** The member courses pages: list, course outline, lesson. Data loaders are mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
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
vi.mock("@/components/courses/LessonPlayer", () => ({
  default: ({ playbackId, posterUrl, lessonId, resumeSeconds, trackProgress }: { playbackId: string; posterUrl?: string | null; lessonId?: string; resumeSeconds?: number; trackProgress?: boolean }) => (
    <div data-testid="player" data-poster={posterUrl ?? ""} data-lesson={lessonId} data-resume={resumeSeconds} data-tracking={String(trackProgress)}>
      {playbackId}
    </div>
  ),
}));
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn(async () => ({})), clearMyLessonProgress: vi.fn(async () => ({})) }));

import LessonPlayerMock from "@/components/courses/LessonPlayer";
import CoursesPage from "@/app/(member)/courses/page";
import CoursePage, { generateMetadata as generateCourseMetadata } from "@/app/(member)/courses/[slug]/page";
import ModulePage, { generateMetadata as generateModuleMetadata } from "@/app/(member)/courses/[slug]/modules/[moduleId]/page";
import LessonPage, { generateMetadata as generateLessonMetadata } from "@/app/(member)/courses/[slug]/lessons/[lessonId]/page";

const LESSON_A = "les_AAAAAAAAAAA1";
const LESSON_B = "les_AAAAAAAAAAA2";
const LESSON_SOON = "les_AAAAAAAAAAA3";

const mod: OutlineModule = { id: "mod", parent_id: null, title: "Month 1", position: 1, state: "open" };
const lesson = (id: string, title: string, position: number, state: "open" | "coming_soon" | "hidden" = "open"): OutlineLesson => ({
  id,
  module_id: "mod",
  title,
  position,
  state,
  duration_seconds: id === LESSON_A ? 545 : null,
  thumbnail_url: id === LESSON_A ? "https://cdn.test/welcome.jpg" : null,
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
  caller.scope.isAdminActing = false;
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

describe("/courses cards", () => {
  it("shows the course image when there is one, and a title placeholder when there isn't", async () => {
    loadCourseList.mockResolvedValue([
      { course: { ...course, thumbnail_url: "https://cdn.test/ready-writer.jpg" }, access: { kind: "open", endsAt: null }, progress: courseProgress(outline, new Set()) },
      { course: { ...course, id: "c2", slug: "bare", title: "Bare Course", thumbnail_url: null }, access: { kind: "open", endsAt: null }, progress: courseProgress(outline, new Set()) },
    ]);
    const { container } = await renderServerPage(CoursesPage, {});

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "https://cdn.test/ready-writer.jpg");
    // The placeholder repeats the title inside the image area.
    expect(screen.getAllByText("Bare Course")).toHaveLength(2);
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

  it("puts the course's hero banner behind the title under a dark overlay, and keeps the plain band without one", async () => {
    const completed = new Set<string>();
    const view = (hero: string | null) => ({ course: { ...course, hero_url: hero }, access: { kind: "open", endsAt: null }, outline, completed, progress: courseProgress(outline, completed) });

    loadCourseView.mockResolvedValue(view("/api/courses/image/hero/crs_AAAAAAAAAAA1"));
    const { container } = await renderServerPage(CoursePage, params());
    const banner = container.querySelector("header img");
    expect(banner).toHaveAttribute("src", "/api/courses/image/hero/crs_AAAAAAAAAAA1");
    expect(banner).toHaveAttribute("alt", "");
    expect(container.querySelector("header [class*='bg-black']")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: course.title })).toBeInTheDocument();

    loadCourseView.mockResolvedValue(view("javascript:alert(1)"));
    const plain = await renderServerPage(CoursePage, params());
    expect(plain.container.querySelector("header img")).toBeNull();
  });

  it("opens the coming-soon lessons in the outline for staff", async () => {
    caller.scope.isAdminActing = true;
    const completed = new Set<string>();
    loadCourseView.mockResolvedValue({ course, access: { kind: "admin" }, outline, completed, progress: courseProgress(outline, completed) });
    await renderServerPage(CoursePage, params());

    expect(within(screen.getByRole("navigation", { name: "Course outline" })).getByRole("link", { name: /Revision/ })).toHaveAttribute(
      "href",
      `/courses/the-ready-writer/lessons/${LESSON_SOON}`
    );
  });

  it("shows staff a draft in the outline as a draft, openable as a preview, and not counted as available", async () => {
    caller.scope.isAdminActing = true;
    const withDraft = buildOutline(
      [mod, { id: "draftmod", parent_id: null, title: "Month 2 (draft)", position: 2, state: "hidden" }],
      [lesson(LESSON_A, "Welcome", 1), { ...lesson(LESSON_SOON, "Secret plot twist", 2, "hidden"), module_id: "draftmod" }],
    );
    loadCourseView.mockResolvedValue({ course, access: { kind: "admin" }, outline: withDraft, completed: new Set(), progress: courseProgress(withDraft, new Set()) });
    await renderServerPage(CoursePage, params());

    const nav = screen.getByRole("navigation", { name: "Course outline" });
    expect(within(nav).getByRole("link", { name: /Secret plot twist/ })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_SOON}`);
    // The module and the lesson both say Draft, and neither says Coming soon.
    expect(within(nav).getAllByText("Draft")).toHaveLength(2);
    expect(within(nav).queryByText("Coming soon")).not.toBeInTheDocument();
    // Only the open lesson counts.
    expect(screen.getByText("0 of 1 available lesson done")).toBeInTheDocument();
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

describe("/courses/[slug]/modules/[moduleId]", () => {
  const params = (moduleId = "mod") => ({ params: Promise.resolve({ slug: "the-ready-writer", moduleId }) });
  const open = (completed = new Set<string>()) =>
    loadCourseView.mockResolvedValue({ course, access: { kind: "open", endsAt: null }, outline, completed, progress: courseProgress(outline, completed) });

  it("is a 404 for a module that isn't in the course", async () => {
    open();
    await expect(Promise.resolve().then(() => ModulePage(params("nope")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("goes back to the course page when the member can't open lessons", async () => {
    loadCourseView.mockResolvedValue({ course, access: { kind: "ended", endsAt: "2026-01-01T00:00:00Z" }, outline, completed: new Set(), progress: courseProgress(outline, new Set()) });
    await expectRedirect(ModulePage, params(), "/courses/the-ready-writer");
  });

  it("lists the module's lessons with a check on completed ones, and links its breadcrumb", async () => {
    open(new Set([LESSON_A]));
    await renderServerPage(ModulePage, params());

    expect(screen.getByRole("heading", { level: 1, name: "Month 1" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 lessons done")).toBeInTheDocument();
    const welcome = screen.getByRole("link", { name: /Welcome.*completed/ });
    expect(welcome).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
    expect(within(welcome).getByTestId("completed-check")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voice" })).toBeInTheDocument();
    // Not released: listed, not linked.
    expect(screen.getByText("Revision")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Revision/ })).not.toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "The Ready Writer" })).toHaveAttribute("href", "/courses/the-ready-writer");
    expect(crumbs.querySelector("[aria-current='page']")).toHaveTextContent("Month 1");
  });

  it("lists nested modules as links with their own progress, under a linked parent crumb", async () => {
    const nested = buildOutline(
      [mod, { id: "week", parent_id: "mod", title: "Week 1", position: 1, state: "open" }, { id: "later", parent_id: "mod", title: "Week 2", position: 2, state: "coming_soon" }],
      [{ ...lesson(LESSON_A, "Welcome", 1), module_id: "week" }, { ...lesson(LESSON_SOON, "Later", 1, "coming_soon"), module_id: "later" }]
    );
    loadCourseView.mockResolvedValue({ course, access: { kind: "open", endsAt: null }, outline: nested, completed: new Set([LESSON_A]), progress: courseProgress(nested, new Set([LESSON_A])) });
    await renderServerPage(ModulePage, params());
    expect(screen.getByRole("link", { name: /Week 1/ })).toHaveAttribute("href", "/courses/the-ready-writer/modules/week");
    expect(screen.queryByRole("link", { name: /Week 2/ })).not.toBeInTheDocument();

    document.body.innerHTML = "";
    await renderServerPage(ModulePage, params("week"));
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Month 1" })).toHaveAttribute("href", "/courses/the-ready-writer/modules/mod");
  });

  it("hides an unreleased module from members and previews it for staff", async () => {
    const soon = buildOutline([{ ...mod, state: "coming_soon" }], [lesson(LESSON_SOON, "Revision", 1, "coming_soon")]);
    loadCourseView.mockResolvedValue({ course, access: { kind: "open", endsAt: null }, outline: soon, completed: new Set(), progress: courseProgress(soon, new Set()) });
    await expectRedirect(ModulePage, params(), "/courses/the-ready-writer");

    caller.scope.isAdminActing = true;
    await renderServerPage(ModulePage, params());
    expect(screen.getByRole("status")).toHaveTextContent("Preview");
    expect(screen.getByRole("link", { name: "Revision" })).toBeInTheDocument();
  });
});

describe("/courses/[slug]/modules/[moduleId] drafts", () => {
  const params = () => ({ params: Promise.resolve({ slug: "the-ready-writer", moduleId: "mod" }) });

  it("says a draft module is a draft, for the staff who can open it", async () => {
    caller.scope.isAdminActing = true;
    const drafted = buildOutline([{ ...mod, state: "hidden" }], [lesson(LESSON_SOON, "Secret plot twist", 1, "hidden")]);
    loadCourseView.mockResolvedValue({ course, access: { kind: "admin" }, outline: drafted, completed: new Set(), progress: courseProgress(drafted, new Set()) });
    await renderServerPage(ModulePage, params());

    expect(screen.getByRole("status")).toHaveTextContent("Draft: this module is a draft, so members can't see it at all.");
    expect(screen.getByRole("link", { name: "Secret plot twist" })).toBeInTheDocument();
  });
});

/** The section list beside the video (or standing in for it); the one in the closed "Lessons in this section" panel is a second copy. */
const sectionList = () => screen.getAllByRole("navigation", { name: "Lessons in this section" }).find((nav) => !nav.closest("details"))!;

describe("/courses/[slug]/lessons/[lessonId]", () => {
  const params = (lessonId = LESSON_B) => ({ params: Promise.resolve({ slug: "the-ready-writer", lessonId }) });
  const ok = (over: Record<string, unknown> = {}) => ({
    kind: "ok",
    view: { course, access: { kind: "open", endsAt: null }, outline, completed: new Set([LESSON_A]), progress: courseProgress(outline, new Set([LESSON_A])) },
    lesson: { ...lesson(LESSON_B, "Voice", 2), body_html: "<h2>Find your voice</h2><p>Write.</p>" },
    neighbors: { previous: lesson(LESSON_A, "Welcome", 1), next: null },
    completed: false,
    video: null,
    resumeSeconds: 0,
    files: [],
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

  it("shows the lesson text, a breadcrumb for where it sits, and mark complete, with no whole-course outline or runtime line", async () => {
    loadLessonView.mockResolvedValue(ok({ lesson: { ...lesson(LESSON_B, "Voice", 2), duration_seconds: 545, body_html: "<h2>Find your voice</h2><p>Write.</p>" } }));
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("heading", { level: 1, name: "Voice" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Find your voice" })).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "The Ready Writer" })).toHaveAttribute("href", "/courses/the-ready-writer");
    expect(within(crumbs).getByRole("link", { name: "Month 1" })).toHaveAttribute("href", "/courses/the-ready-writer/modules/mod");
    expect(crumbs.querySelector("[aria-current='page']")).toHaveTextContent("Voice");
    expect(screen.queryByText(/Lesson 2 of/)).not.toBeInTheDocument();
    expect(screen.queryByText("9:05")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as complete" })).toBeEnabled();
    expect(screen.queryByRole("navigation", { name: "Course outline" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the full course outline" })).toHaveAttribute("href", "/courses/the-ready-writer");
  });

  it("puts the title and text below the video and its Back / Mark complete / Next controls", async () => {
    signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
    loadLessonView.mockResolvedValue(ok({ video: { status: "ready", playbackId: "pb-1" } }));
    await renderServerPage(LessonPage, params());

    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const player = screen.getByTestId("player");
    const controls = screen.getByRole("button", { name: "Mark as complete" });
    const title = screen.getByRole("heading", { level: 1, name: "Voice" });
    expect(follows(player, controls)).toBe(true);
    expect(follows(controls, title)).toBe(true);
  });

  it("puts Back and Next buttons under the video, disabled at the ends, and cards with titles at the bottom", async () => {
    loadLessonView.mockResolvedValue(ok());
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("link", { name: "Back: Welcome" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
    expect(screen.getByText("Next →", { selector: "span[aria-disabled]" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: /Previous.*Welcome/ })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
    expect(screen.queryByRole("link", { name: /^Next/ })).not.toBeInTheDocument();
  });

  it("puts the main action, title and text together in one bounded card, like the Downloads card beside it", async () => {
    loadLessonView.mockResolvedValue(ok({ files: [{ id: "f1", filename: "Sheet.pdf", size_bytes: 10 }] }));
    await renderServerPage(LessonPage, params());

    const card = screen.getByRole("article");
    expect(card).toHaveClass("rounded-xl", "border", "bg-white", "dark:bg-slate-900");
    expect(card).toContainElement(screen.getByRole("button", { name: "Mark as complete" }));
    expect(card).toContainElement(screen.getByRole("heading", { level: 1, name: "Voice" }));
    expect(card).toContainElement(screen.getByRole("heading", { name: "Find your voice" }));
    // The Downloads card is its own bordered card in the next column, level with it.
    const downloads = screen.getByRole("region", { name: "Downloads" });
    expect(downloads).toHaveClass("rounded-xl", "border");
    expect(card).not.toContainElement(downloads);
    // The Back / Next buttons stay outside it, under the video.
    expect(card).not.toContainElement(screen.getByRole("link", { name: "Back: Welcome" }));
  });

  it("keeps the next-lesson card inside the text card, right after the button", async () => {
    loadLessonView.mockResolvedValue(ok({ completed: true, neighbors: { previous: null, next: lesson(LESSON_A, "Welcome", 1) } }));
    await renderServerPage(LessonPage, params());

    const card = screen.getByRole("article");
    const preview = screen.getByText("Great job! Keep going!").closest("a")!;
    expect(card).toContainElement(preview);
    expect(Boolean(screen.getByRole("button", { name: "Complete" }).compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  describe("Mark complete and Back / Next under the video", () => {
    const withVideo = (over: Record<string, unknown> = {}) => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      loadLessonView.mockResolvedValue(ok({ video: { status: "ready", playbackId: "pb-1" }, ...over }));
    };

    it("makes Mark complete the wide main action, wider than Back and Next", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      const complete = screen.getByRole("button", { name: "Mark as complete" });
      expect(complete).toHaveClass("w-full", "py-3");
      const back = screen.getByRole("link", { name: "Back: Welcome" });
      expect(back).not.toHaveClass("w-full");
    });

    it("hides Back and Next on a wide screen, where this section's lessons sit beside the video", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      expect(screen.getByRole("link", { name: "Back: Welcome" }).parentElement).toHaveClass("@outline:hidden");
      // Still in the page for smaller screens, where the list is hidden and they're the way to move around.
      expect(screen.getByRole("link", { name: "Back: Welcome" })).toBeInTheDocument();
    });

    it("keeps Back and Next at every width when there is no list beside the video (a lesson outside any module)", async () => {
      const looseOutline = buildOutline([], [lesson(LESSON_B, "Voice", 2)].map((l) => ({ ...l, module_id: null })));
      withVideo({ view: { course, access: { kind: "open", endsAt: null }, outline: looseOutline, completed: new Set(), progress: courseProgress(looseOutline, new Set()) } });
      await renderServerPage(LessonPage, params());

      expect(screen.getByRole("link", { name: "Back: Welcome" }).parentElement).not.toHaveClass("@outline:hidden");
    });

    it("keeps Back and Next when the lesson has no video (the list isn't beside a player then)", async () => {
      loadLessonView.mockResolvedValue(ok());
      await renderServerPage(LessonPage, params());

      expect(screen.getByRole("link", { name: "Back: Welcome" }).parentElement).not.toHaveClass("@outline:hidden");
    });

    it("puts Mark complete below the Back / Next row", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      const back = screen.getByRole("link", { name: "Back: Welcome" });
      const complete = screen.getByRole("button", { name: "Mark as complete" });
      expect(Boolean(back.compareDocumentPosition(complete) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });
  });

  it("links the next lesson from both the button and the card", async () => {
    loadLessonView.mockResolvedValue(ok({ neighbors: { previous: null, next: lesson(LESSON_B, "Voice", 2) } }));
    await renderServerPage(LessonPage, params(LESSON_A));

    const href = `/courses/the-ready-writer/lessons/${LESSON_B}`;
    expect(screen.getByRole("link", { name: "Next: Voice" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: /^Next →\s*Voice/ })).toHaveAttribute("href", href);
    expect(screen.getByText("← Back", { selector: "span[aria-disabled]" })).toBeInTheDocument();
  });

  describe("this section's lessons", () => {
    const withVideo = () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      loadLessonView.mockResolvedValue(ok({ video: { status: "ready", playbackId: "pb-1" } }));
    };

    it("is one component with the video: a panel in the same container, hidden on a phone", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      const section = sectionList();
      const aside = section.closest("aside")!;
      expect(aside).toHaveClass("relative", "hidden", "@outline:block");
      expect(aside.parentElement).toContainElement(screen.getByTestId("player")); // the player and the list share one container
    });

    it("repeats the list in a closed panel under the video, which goes away once the list sits beside it", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      const details = screen.getByText("Lessons in this section", { selector: "summary span" }).closest("details")!;
      expect(details).not.toHaveAttribute("open");
      expect(details).toHaveClass("@outline:hidden");
      expect(within(details).getByRole("navigation", { name: "Lessons in this section" })).toBeInTheDocument();
    });

    it("has the closed panel for a lesson with no video too", async () => {
      loadLessonView.mockResolvedValue(ok({ video: null }));
      await renderServerPage(LessonPage, params());

      expect(screen.getByText("Lessons in this section", { selector: "summary span" }).closest("details")).toHaveClass("@outline:hidden");
    });

    it("lists the module's lessons with number, check or marker, aligned thumbnail and title, and nothing from other modules", async () => {
      withVideo();
      const { container } = await renderServerPage(LessonPage, params());

      const section = sectionList();
      expect(within(section).getByRole("heading", { name: "Month 1" })).toBeInTheDocument();
      expect(within(section).getByText("3 Lessons")).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: /Welcome \(completed\)/ })).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: /Voice/ })).toHaveAttribute("aria-current", "page");
      expect(container.querySelector("img[src='https://cdn.test/welcome.jpg']")).not.toBeNull();
    });

    it("shows unreleased lessons dimmed and unlinked, with no 'Coming soon' label", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      const section = sectionList();
      expect(within(section).getByText("Revision")).toBeInTheDocument();
      expect(within(section).queryByRole("link", { name: /Revision/ })).not.toBeInTheDocument();
      expect(within(section).queryByText(/Coming soon/)).not.toBeInTheDocument();
    });

    it("stands in the side column for a lesson with no video", async () => {
      loadLessonView.mockResolvedValue(ok());
      await renderServerPage(LessonPage, params());

      const section = sectionList();
      expect(section.closest("div.hidden")).toHaveClass("@outline:block");
    });
  });

  describe("Next Module and the next-lesson card", () => {
    const twoModules = buildOutline(
      [mod, { id: "mod2", parent_id: null, title: "Week 2", position: 2, state: "open" }],
      [lesson(LESSON_A, "Welcome", 1), lesson(LESSON_B, "Voice", 2), { ...lesson("les_AAAAAAAAAAA4", "Next week", 1), module_id: "mod2" }]
    );
    const NEXT_WEEK = "les_AAAAAAAAAAA4";
    const inTwoModules = (over: Record<string, unknown> = {}) => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      loadLessonView.mockResolvedValue(
        ok({
          video: { status: "ready", playbackId: "pb-1" },
          view: { course, access: { kind: "open", endsAt: null }, outline: twoModules, completed: new Set(), progress: courseProgress(twoModules, new Set()) },
          ...over,
        })
      );
    };

    it("offers Next Module in the section list, to the next module's first lesson", async () => {
      inTwoModules();
      await renderServerPage(LessonPage, params());

      const section = sectionList();
      expect(within(section).getByRole("link", { name: "Next Module" })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${NEXT_WEEK}`);
    });

    it("has no Next Module in the last module", async () => {
      loadLessonView.mockResolvedValue(ok({ video: null }));
      await renderServerPage(LessonPage, params());

      expect(screen.queryByRole("link", { name: "Next Module" })).not.toBeInTheDocument();
    });

    it("shows no next-lesson card until the lesson is complete", async () => {
      inTwoModules({ neighbors: { previous: null, next: lesson(LESSON_B, "Voice", 2) } });
      await renderServerPage(LessonPage, params(LESSON_A));

      expect(screen.queryByText("Great job! Keep going!")).not.toBeInTheDocument();
    });

    it("previews the next lesson, with its thumbnail, once the lesson is complete", async () => {
      inTwoModules({ completed: true, neighbors: { previous: null, next: lesson(LESSON_A, "Welcome", 1) } });
      const { container } = await renderServerPage(LessonPage, params(LESSON_B));

      const complete = screen.getByRole("button", { name: "Complete" });
      expect(complete).toHaveClass("bg-plum-600");
      const card = screen.getByRole("status");
      expect(card).toHaveTextContent("Welcome");
      expect(card).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_A}`);
      expect(container.querySelector("a[role='status'] img")).toHaveAttribute("src", "https://cdn.test/welcome.jpg");
    });

    it("wraps the player, the button and the card in one completion state, so the player can complete the lesson", async () => {
      inTwoModules();
      await renderServerPage(LessonPage, params());

      // The player stand-in and the button both render inside the page's provider (the button renders nothing without one).
      expect(screen.getByTestId("player")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark as complete" })).toBeInTheDocument();
    });
  });

  it("shows a lesson's downloads once: beside the text on a wide screen, after it on a phone", async () => {
    const files = [{ id: "f1", filename: "Tracker_Sheet.pdf", size_bytes: 2048 }];
    loadLessonView.mockResolvedValue(ok({ files }));
    await renderServerPage(LessonPage, params());

    const card = screen.getByRole("region", { name: "Downloads" });
    expect(card.parentElement).toHaveClass("@outline:col-start-2", "@outline:row-start-3");
    expect(within(card).getByRole("link", { name: /Tracker_Sheet\.pdf/ })).toHaveAttribute("href", `/courses/the-ready-writer/lessons/${LESSON_B}/files/f1`);
    const text = screen.getByRole("heading", { level: 1, name: "Voice" });
    expect(Boolean(text.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true); // after the text in reading order
  });

  it("shows no downloads card when the lesson has none", async () => {
    loadLessonView.mockResolvedValue(ok());
    await renderServerPage(LessonPage, params());

    expect(screen.queryByRole("region", { name: "Downloads" })).not.toBeInTheDocument();
  });

  it("plays a ready video with signed tokens minted for it", async () => {
    signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
    loadLessonView.mockResolvedValue(ok({ video: { status: "ready", playbackId: "pb-1" } }));
    await renderServerPage(LessonPage, params());

    expect(screen.getByTestId("player")).toHaveTextContent("pb-1");
    expect(signPlaybackTokens).toHaveBeenCalledWith({}, "pb-1");
  });

  it("gives the player the lesson's own thumbnail as its poster", async () => {
    signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
    loadLessonView.mockResolvedValue(
      ok({ video: { status: "ready", playbackId: "pb-1" }, lesson: { ...lesson(LESSON_B, "Voice", 2), thumbnail_url: "https://cdn.test/voice.jpg", body_html: null } })
    );
    await renderServerPage(LessonPage, params());

    expect(screen.getByTestId("player")).toHaveAttribute("data-poster", "https://cdn.test/voice.jpg");
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

  it("shows staff a preview of a coming-soon lesson: the standard strip, a disabled mark complete with a reason, and the section list opens", async () => {
    caller.scope.isAdminActing = true;
    loadLessonView.mockResolvedValue(ok({ preview: true }));
    await renderServerPage(LessonPage, params());

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Preview: members see this lesson as “Coming soon”");
    // The same strip as the notification banners under the header (plum, full width), not a card inside the page.
    expect(banner).toHaveClass("bg-plum-600", "border-b", "text-white");
    expect(banner.parentElement?.className).not.toMatch(/max-w|container/);
    const button = screen.getByRole("button", { name: "Mark as complete" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Progress isn't tracked for lessons members can't open yet");
    // Staff can open coming-soon lessons from the section list too.
    expect(within(sectionList()).getByRole("link", { name: /Revision/ })).toBeInTheDocument();
  });

  it("doesn't name Kajabi in a preview or draft banner (members and most staff don't know it)", async () => {
    caller.scope.isAdminActing = true;
    loadLessonView.mockResolvedValue(ok({ preview: true }));
    const soon = await renderServerPage(LessonPage, params());
    expect(screen.getByRole("status")).toHaveTextContent("until it's published.");
    expect(soon.container.textContent).not.toMatch(/kajabi/i);
    soon.unmount();

    loadLessonView.mockResolvedValue(ok({ preview: true, lesson: { ...lesson(LESSON_B, "Voice", 2, "hidden"), body_html: "" } }));
    const draft = await renderServerPage(LessonPage, params());
    expect(draft.container.textContent).not.toMatch(/kajabi/i);
  });

  it("tells staff a draft lesson is a draft, not 'coming soon', and keeps its progress untracked", async () => {
    caller.scope.isAdminActing = true;
    loadLessonView.mockResolvedValue(ok({ preview: true, lesson: { ...lesson(LESSON_B, "Voice", 2, "hidden"), body_html: "<p>Draft text</p>" } }));
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("status")).toHaveTextContent("Draft: this lesson is a draft, so members can't see it at all.");
    expect(screen.getByRole("status")).not.toHaveTextContent("Coming soon");
    expect(screen.getByRole("button", { name: "Mark as complete" })).toBeDisabled();
    expect(screen.getByText("Draft text")).toBeInTheDocument();
  });

  describe("watch tracking", () => {
    const withVideo = (over: Record<string, unknown> = {}) => ok({ video: { id: "vid", status: "ready", playbackId: "pb-1" }, resumeSeconds: 125, ...over });

    it("hands the player the lesson, where the member left off, and turns tracking on", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      loadLessonView.mockResolvedValue(withVideo());
      await renderServerPage(LessonPage, params());

      expect(screen.getByTestId("player")).toHaveAttribute("data-lesson", LESSON_B);
      expect(screen.getByTestId("player")).toHaveAttribute("data-resume", "125");
      expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "true");
    });

    it("starts at the second a shared link asks for (?t=), over the saved position, and ignores a bad one", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      loadLessonView.mockResolvedValue(withVideo());
      await renderServerPage(LessonPage, { ...params(), searchParams: Promise.resolve({ t: "95" }) });
      expect(screen.getByTestId("player")).toHaveAttribute("data-resume", "95");
      cleanup();

      await renderServerPage(LessonPage, { ...params(), searchParams: Promise.resolve({ t: "soon" }) });
      expect(screen.getByTestId("player")).toHaveAttribute("data-resume", "125");
    });

    it("keys the player by lesson, so moving between lessons gets a fresh player and tracker", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      const keyOfPlayer = async (lessonId: string) => {
        loadLessonView.mockResolvedValue(withVideo({ lesson: { ...lesson(lessonId, "L", 1), body_html: "" } }));
        const find = (node: unknown): string | null | undefined => {
          if (Array.isArray(node)) return node.map(find).find((k) => k !== undefined);
          if (!node || typeof node !== "object" || !("props" in node)) return undefined;
          const el = node as { type: unknown; key: string | null; props: { children?: unknown } };
          return el.type === LessonPlayerMock ? el.key : find(el.props.children);
        };
        return find(await LessonPage(params(lessonId)));
      };

      expect(await keyOfPlayer(LESSON_A)).toBe(LESSON_A);
      expect(await keyOfPlayer(LESSON_B)).toBe(LESSON_B);
    });

    const withTrack = (track?: string) => ({ ...params(), searchParams: Promise.resolve(track ? { track } : {}) });

    it("lets staff turn recording on for a preview with ?track=1, and says so", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      caller.scope.isAdminActing = true;
      loadLessonView.mockResolvedValue(withVideo({ preview: true }));
      await renderServerPage(LessonPage, withTrack("1"));

      expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Your watching is recorded (completion isn't).");
    });

    it("keeps a preview off by default", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      caller.scope.isAdminActing = true;
      loadLessonView.mockResolvedValue(withVideo({ preview: true }));
      await renderServerPage(LessonPage, withTrack());

      expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "false");
      expect(screen.getByRole("status")).toHaveTextContent("Progress isn't tracked here.");
    });

    it("never records in sudo, even with ?track=1", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      caller.identity.isSudo = true;
      loadLessonView.mockResolvedValue(withVideo());
      await renderServerPage(LessonPage, withTrack("1"));

      expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "false");
      expect(screen.queryByLabelText("Staff tools")).not.toBeInTheDocument();
    });

    it("leaves the staff tools to the admin course page, even for staff acting as themselves", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      caller.scope.isAdminActing = true;
      loadLessonView.mockResolvedValue(withVideo());
      await renderServerPage(LessonPage, params());
      expect(screen.queryByLabelText("Staff tools")).not.toBeInTheDocument();
    });

    it("leaves tracking off in sudo and in a staff preview, which leave no viewing history", async () => {
      signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
      caller.identity.isSudo = true;
      loadLessonView.mockResolvedValue(withVideo());
      await renderServerPage(LessonPage, params());
      expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "false");
      cleanup();

      caller.identity.isSudo = false;
      caller.scope.isAdminActing = true;
      loadLessonView.mockResolvedValue(withVideo({ preview: true }));
      await renderServerPage(LessonPage, params());
      expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "false");
    });
  });

  it("disables mark complete in sudo, which is read-only", async () => {
    caller.identity.isSudo = true;
    loadLessonView.mockResolvedValue(ok());
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("button", { name: "Mark as complete" })).toBeDisabled();
  });
});

describe("course page tab titles", () => {
  const nested = buildOutline(
    [
      { id: "m2", parent_id: null, title: "Module 2: What Your Novel Needs", position: 1, state: "open" },
      { id: "w1", parent_id: "m2", title: "Week 1: Writing for Yourself", position: 1, state: "open" },
    ],
    [{ id: LESSON_A, module_id: "w1", title: "Lesson 1: Reader Expectations", position: 1, state: "open", duration_seconds: null, thumbnail_url: null }],
  );
  const view = (access: { kind: string; endsAt?: null },withOutline = true) => ({ course, access, outline: withOutline ? nested : null, completed: new Set<string>(), progress: null });
  const slugParams = { params: Promise.resolve({ slug: course.slug }) };

  it("names the course on the course page", async () => {
    loadCourseView.mockResolvedValue(view({ kind: "open", endsAt: null }));
    expect(await generateCourseMetadata(slugParams)).toEqual({ title: "The Ready Writer · Courses" });
  });

  it("names the module and the modules above it, innermost first", async () => {
    loadCourseView.mockResolvedValue(view({ kind: "open", endsAt: null }));
    const metadata = await generateModuleMetadata({ params: Promise.resolve({ slug: course.slug, moduleId: "w1" }) });
    expect(metadata.title).toBe("Week 1: Writing for Yourself · Module 2: What Your Novel Needs · The Ready Writer · Courses");
  });

  it("names the lesson, then its modules, then the course", async () => {
    loadCourseView.mockResolvedValue(view({ kind: "open", endsAt: null }));
    const metadata = await generateLessonMetadata({ params: Promise.resolve({ slug: course.slug, lessonId: LESSON_A }) });
    expect(metadata.title).toBe(
      "Lesson 1: Reader Expectations · Week 1: Writing for Yourself · Module 2: What Your Novel Needs · The Ready Writer · Courses",
    );
  });

  it("shows only the course name to someone who can't open it", async () => {
    loadCourseView.mockResolvedValue(view({ kind: "none" }, false));
    const metadata = await generateLessonMetadata({ params: Promise.resolve({ slug: course.slug, lessonId: LESSON_A }) });
    expect(metadata.title).toBe("The Ready Writer · Courses");
  });

  it("falls back to Courses for a course that doesn't exist", async () => {
    loadCourseView.mockResolvedValue(null);
    expect(await generateCourseMetadata(slugParams)).toEqual({ title: "Courses" });
  });
});

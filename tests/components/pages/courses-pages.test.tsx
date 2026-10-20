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
  default: ({ playbackId, posterUrl }: { playbackId: string; posterUrl?: string | null }) => (
    <div data-testid="player" data-poster={posterUrl ?? ""}>
      {playbackId}
    </div>
  ),
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
    expect(within(crumbs).getByText("Month 1")).toBeInTheDocument();
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

      expect(screen.getByRole("link", { name: "Back: Welcome" }).parentElement).toHaveClass("lg:hidden");
      // Still in the page for smaller screens, where the list is hidden and they're the way to move around.
      expect(screen.getByRole("link", { name: "Back: Welcome" })).toBeInTheDocument();
    });

    it("keeps Back and Next at every width when there is no list beside the video (a lesson outside any module)", async () => {
      const looseOutline = buildOutline([], [lesson(LESSON_B, "Voice", 2)].map((l) => ({ ...l, module_id: null })));
      withVideo({ view: { course, access: { kind: "open", endsAt: null }, outline: looseOutline, completed: new Set(), progress: courseProgress(looseOutline, new Set()) } });
      await renderServerPage(LessonPage, params());

      expect(screen.getByRole("link", { name: "Back: Welcome" }).parentElement).not.toHaveClass("lg:hidden");
    });

    it("keeps Back and Next when the lesson has no video (the list isn't beside a player then)", async () => {
      loadLessonView.mockResolvedValue(ok());
      await renderServerPage(LessonPage, params());

      expect(screen.getByRole("link", { name: "Back: Welcome" }).parentElement).not.toHaveClass("lg:hidden");
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

      const section = screen.getByRole("navigation", { name: "Lessons in this section" });
      const aside = section.closest("aside")!;
      expect(aside).toHaveClass("relative", "hidden", "lg:block");
      expect(aside.parentElement).toContainElement(screen.getByTestId("player")); // the player and the list share one container
    });

    it("lists the module's lessons with number, check or marker, aligned thumbnail and title, and nothing from other modules", async () => {
      withVideo();
      const { container } = await renderServerPage(LessonPage, params());

      const section = screen.getByRole("navigation", { name: "Lessons in this section" });
      expect(within(section).getByRole("heading", { name: "Month 1" })).toBeInTheDocument();
      expect(within(section).getByText("3 Lessons")).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: /Welcome \(completed\)/ })).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: /Voice/ })).toHaveAttribute("aria-current", "page");
      expect(container.querySelector("img[src='https://cdn.test/welcome.jpg']")).not.toBeNull();
    });

    it("shows unreleased lessons dimmed and unlinked, with no 'Coming soon' label", async () => {
      withVideo();
      await renderServerPage(LessonPage, params());

      const section = screen.getByRole("navigation", { name: "Lessons in this section" });
      expect(within(section).getByText("Revision")).toBeInTheDocument();
      expect(within(section).queryByRole("link", { name: /Revision/ })).not.toBeInTheDocument();
      expect(within(section).queryByText(/Coming soon/)).not.toBeInTheDocument();
    });

    it("stands in the side column for a lesson with no video", async () => {
      loadLessonView.mockResolvedValue(ok());
      await renderServerPage(LessonPage, params());

      const section = screen.getByRole("navigation", { name: "Lessons in this section" });
      expect(section.closest("div.hidden")).toHaveClass("lg:block");
    });
  });

  describe("Next Module and the next-lesson card", () => {
    const twoModules = buildOutline(
      [mod, { id: "mod2", parent_id: null, title: "Week 2", position: 2, state: "open" }],
      [lesson(LESSON_A, "Welcome", 1), lesson(LESSON_B, "Voice", 2), { ...lesson("44444444-4444-4444-8444-444444444444", "Next week", 1), module_id: "mod2" }]
    );
    const NEXT_WEEK = "44444444-4444-4444-8444-444444444444";
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

      const section = screen.getByRole("navigation", { name: "Lessons in this section" });
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
    expect(card.parentElement).toHaveClass("lg:col-start-2", "lg:row-start-3");
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
    expect(within(screen.getByRole("navigation", { name: "Lessons in this section" })).getByRole("link", { name: /Revision/ })).toBeInTheDocument();
  });

  it("disables mark complete in sudo, which is read-only", async () => {
    caller.identity.isSudo = true;
    loadLessonView.mockResolvedValue(ok());
    await renderServerPage(LessonPage, params());

    expect(screen.getByRole("button", { name: "Mark as complete" })).toBeDisabled();
  });
});

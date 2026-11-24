// @vitest-environment jsdom
/** Comment counts beside the lessons of the course outline: behind the `lesson_comments` flag, staff also see the unanswered questions. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { buildOutline, courseProgress, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import CourseOutline from "@/app/(member)/courses/CourseOutline";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const caller = { userId: "u", identity: { memberId: "mbr_AAAAAAAAAAA1", isSudo: false }, scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false } };
vi.mock("@/lib/courses/caller", () => ({ requireCoursesPage: async () => caller }));

const loadCourseView = vi.fn();
vi.mock("@/lib/courses/member", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/courses/member")>()),
  loadCourseView: (...a: unknown[]) => loadCourseView(...a),
}));
vi.mock("@/lib/courses/address-redirect", () => ({ redirectOldCourseAddress: vi.fn() }));

const flag = { on: true };
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: async () => [],
  effectiveMemberHasFeature: async (key: string) => key === "lesson_comments" && flag.on,
}));

const LESSON_A = "les_AAAAAAAAAAA1";
const LESSON_B = "les_AAAAAAAAAAA2";
const counts = new Map([[LESSON_A, { total: 3, unanswered: 1, newCount: 2 }]]);
const outlineCounts = vi.fn(async (..._args: unknown[]) => counts);
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: (client: never) => ({ ...actual.createRepos(client), courseComments: { outlineCounts: (...a: unknown[]) => outlineCounts(...a) } }) };
});

import CoursePage from "@/app/(member)/courses/[slug]/page";

const mod: OutlineModule = { id: "mod", parent_id: null, title: "Month 1", position: 1, state: "open" };
const lesson = (id: string, title: string, position: number): OutlineLesson => ({ id, module_id: "mod", title, position, state: "open", duration_seconds: 60, thumbnail_url: null });
const outline = buildOutline([mod], [lesson(LESSON_A, "Welcome", 1), lesson(LESSON_B, "Voice", 2)]);
const course = { id: "crs_AAAAAAAAAAA1", slug: "the-ready-writer", title: "The Ready Writer", description: null, thumbnail_url: null, hero_url: null, is_draft: false };
const params = { params: Promise.resolve({ slug: "the-ready-writer" }) };
const view = (access: Record<string, unknown> = { kind: "open", endsAt: null }) => ({
  course,
  access,
  outline,
  completed: new Set<string>(),
  progress: courseProgress(outline, new Set<string>()),
});

beforeEach(() => {
  cleanup();
  resetServerPageMocks();
  loadCourseView.mockReset();
  outlineCounts.mockClear();
  flag.on = true;
  caller.scope.isAdminActing = false;
});

describe("CourseOutline comment badges", () => {
  const props = { slug: "the-ready-writer", outline, completed: new Set<string>(), canOpen: true };

  it("says how many comments a lesson has and how many are new, and shows nothing for a lesson with none", () => {
    render(<CourseOutline {...props} commentCounts={counts} />);
    const row = screen.getByRole("link", { name: /Welcome/ });
    expect(within(row).getByTestId("comment-badge")).toHaveTextContent("3 comments, 2 new");
    expect(within(screen.getByRole("link", { name: /Voice/ })).queryByTestId("comment-badge")).toBeNull();
  });

  it("adds the unanswered questions for staff only", () => {
    const { rerender } = render(<CourseOutline {...props} commentCounts={counts} />);
    expect(screen.getByTestId("comment-badge")).not.toHaveTextContent("unanswered");
    rerender(<CourseOutline {...props} commentCounts={counts} showUnanswered />);
    expect(screen.getByTestId("comment-badge")).toHaveTextContent("3 comments, 2 new, 1 unanswered");
  });

  it("uses the singular, and stays plain when nothing is new", () => {
    render(<CourseOutline {...props} commentCounts={new Map([[LESSON_B, { total: 1, unanswered: 0, newCount: 0 }]])} />);
    expect(screen.getByTestId("comment-badge")).toHaveTextContent("1 comment");
    expect(screen.getByTestId("comment-badge")).not.toHaveTextContent("new");
  });

  it("has no badges without counts", () => {
    render(<CourseOutline {...props} />);
    expect(screen.queryByTestId("comment-badge")).toBeNull();
  });
});

describe("course page comment counts", () => {
  it("reads the counts for the member when the flag is on and the lessons open", async () => {
    loadCourseView.mockResolvedValue(view());
    await renderServerPage(CoursePage, params);
    expect(outlineCounts).toHaveBeenCalledWith("crs_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA1");
    expect(screen.getByTestId("comment-badge")).toHaveTextContent("3 comments, 2 new");
    expect(screen.getByTestId("comment-badge")).not.toHaveTextContent("unanswered");
  });

  it("tells staff about unanswered questions", async () => {
    caller.scope.isAdminActing = true;
    loadCourseView.mockResolvedValue(view());
    await renderServerPage(CoursePage, params);
    expect(screen.getByTestId("comment-badge")).toHaveTextContent("1 unanswered");
  });

  it("reads nothing with the flag off, or once the member's access has ended", async () => {
    flag.on = false;
    loadCourseView.mockResolvedValue(view());
    await renderServerPage(CoursePage, params);
    expect(outlineCounts).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-badge")).toBeNull();

    cleanup();
    flag.on = true;
    loadCourseView.mockResolvedValue(view({ kind: "ended", endsAt: "2027-01-01T00:00:00Z" }));
    await renderServerPage(CoursePage, params);
    expect(outlineCounts).not.toHaveBeenCalled();
  });
});

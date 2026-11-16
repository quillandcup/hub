// @vitest-environment jsdom
/** /admin/courses/[id]/comments: the questions nobody on staff has answered yet. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const requireAdminPage = vi.fn();
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

const unanswered = vi.fn();
const courseById = vi.fn();
vi.mock("@/lib/courses/course-param", () => ({ resolveCourseParam: async (_repos: unknown, id: string) => id }));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({ courses: { courseById: (...a: unknown[]) => courseById(...a) }, courseComments: { unansweredQuestions: (...a: unknown[]) => unanswered(...a) } }),
}));

import CourseCommentsPage from "@/app/(admin)/admin/courses/[id]/comments/page";

const COURSE = "crs_AAAAAAAAAAA1";
const params = (id = COURSE) => ({ params: Promise.resolve({ id }) });
const question = (id: string, lessonTitle: string, authorName: string, body: string, createdAt: string) => ({
  id,
  lessonId: "les_AAAAAAAAAAA1",
  lessonTitle,
  authorName,
  createdAt,
  body,
});

beforeEach(() => {
  cleanup();
  resetServerPageMocks();
  requireAdminPage.mockReset().mockResolvedValue(undefined);
  unanswered.mockReset().mockResolvedValue([]);
  courseById.mockReset().mockResolvedValue({ id: COURSE, slug: "the-ready-writer", title: "The Ready Writer" });
});

describe("admin course comments page", () => {
  it("checks for an admin first, and stops when that redirects", async () => {
    requireAdminPage.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(renderServerPage(CourseCommentsPage, params())).rejects.toThrow();
    expect(unanswered).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is not a course", async () => {
    await expect(renderServerPage(CourseCommentsPage, params("not-an-id"))).rejects.toThrow();
    courseById.mockResolvedValue(null);
    await expect(renderServerPage(CourseCommentsPage, params())).rejects.toThrow();
  });

  it("says when nothing is waiting", async () => {
    await renderServerPage(CourseCommentsPage, params());
    expect(screen.getByRole("heading", { name: "Unanswered questions" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
  });

  it("lists the waiting questions with a link to each lesson's thread, oldest first by default, names as typed", async () => {
    unanswered.mockResolvedValue([
      question("cmnt_AAAAAAAAAAA1", "Voice", "Ada <Quill> & Co", "How do I start <b>this</b>?", "2027-01-01T12:00:00.000Z"),
      question("cmnt_AAAAAAAAAAA2", "Hooks", "Bea Example", "x".repeat(300), "2027-01-02T12:00:00.000Z"),
    ]);
    await renderServerPage(CourseCommentsPage, params());

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Ada <Quill> & Co")).toBeInTheDocument();
    expect(within(rows[0]).getByText("How do I start <b>this</b>?")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Voice" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/les_AAAAAAAAAAA1#cmnt_AAAAAAAAAAA1");
    expect(within(rows[1]).getByText(/^x{140}…$/)).toBeInTheDocument();
  });

  it("filters by what you type", async () => {
    unanswered.mockResolvedValue([
      question("cmnt_AAAAAAAAAAA1", "Voice", "Ada Example", "About tone", "2027-01-01T12:00:00.000Z"),
      question("cmnt_AAAAAAAAAAA2", "Hooks", "Bea Example", "About openings", "2027-01-02T12:00:00.000Z"),
    ]);
    await renderServerPage(CourseCommentsPage, params());
    await userEvent.type(screen.getByRole("searchbox", { name: "Search questions" }), "openings");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("About openings")).toBeInTheDocument();
  });
});

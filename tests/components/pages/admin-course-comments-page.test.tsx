// @vitest-environment jsdom
/** /admin/courses/[id]/comments (unanswered questions) and /comments/moderation (reports and held comments), tabs by path. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderServerPage, resetServerPageMocks, routerMock } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));

const requirePermission = vi.fn();
vi.mock("@/lib/admin-auth", () => ({ requirePermission: () => requirePermission() }));

const actions = {
  hideLessonComment: vi.fn(),
  deleteLessonCommentAsStaff: vi.fn(),
  dismissLessonCommentReports: vi.fn(),
  approveHeldLessonComment: vi.fn(),
  markLessonCommentHandled: vi.fn(),
};
vi.mock("@/app/(admin)/admin/courses/comment-moderation-actions", () => ({
  hideLessonComment: (...a: unknown[]) => actions.hideLessonComment(...a),
  deleteLessonCommentAsStaff: (...a: unknown[]) => actions.deleteLessonCommentAsStaff(...a),
  dismissLessonCommentReports: (...a: unknown[]) => actions.dismissLessonCommentReports(...a),
  approveHeldLessonComment: (...a: unknown[]) => actions.approveHeldLessonComment(...a),
  markLessonCommentHandled: (...a: unknown[]) => actions.markLessonCommentHandled(...a),
}));

const unanswered = vi.fn();
const openReports = vi.fn();
const heldComments = vi.fn();
const courseById = vi.fn();
vi.mock("@/lib/courses/course-param", () => ({ resolveCourseParam: async (_repos: unknown, id: string) => id }));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    courses: { courseById: (...a: unknown[]) => courseById(...a) },
    courseComments: {
      unansweredQuestions: (...a: unknown[]) => unanswered(...a),
      openReports: (...a: unknown[]) => openReports(...a),
      heldComments: (...a: unknown[]) => heldComments(...a),
    },
  }),
}));

import CourseCommentsPage from "@/app/(admin)/admin/courses/[id]/comments/page";
import CourseCommentsModerationPage from "@/app/(admin)/admin/courses/[id]/comments/moderation/page";

const COURSE = "crs_AAAAAAAAAAA1";
const params = (id = COURSE) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const question = (id: string, lessonTitle: string, authorName: string, body: string, createdAt: string) => ({
  id,
  lessonId: "les_AAAAAAAAAAA1",
  lessonTitle,
  authorName,
  createdAt,
  body,
});
const reported = (commentId: string, over: Record<string, unknown> = {}) => ({
  commentId,
  lessonId: "les_AAAAAAAAAAA1",
  lessonTitle: "Voice",
  authorName: "Ada <Quill> & Co",
  body: "Words <b>reported</b>",
  isReply: false,
  state: "visible",
  reportCount: 2,
  reasons: ["Spam & ads", "Rude"],
  firstReportedAt: "2027-01-01T12:00:00.000Z",
  ...over,
});
const held = (id: string) => ({ id, lessonId: "les_AAAAAAAAAAA2", lessonTitle: "Hooks", authorName: "Bea Example", body: "a b c d", isReply: false, createdAt: "2027-01-02T12:00:00.000Z" });

beforeEach(() => {
  cleanup();
  resetServerPageMocks();
  track.mockReset();
  routerMock.refresh.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ changed: true });
  requirePermission.mockReset().mockResolvedValue(undefined);
  unanswered.mockReset().mockResolvedValue([]);
  openReports.mockReset().mockResolvedValue([]);
  heldComments.mockReset().mockResolvedValue([]);
  courseById.mockReset().mockResolvedValue({ id: COURSE, slug: "the-ready-writer", title: "The Ready Writer" });
});

describe("admin course comments page", () => {
  it("checks for an admin first, and stops when that redirects", async () => {
    requirePermission.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(renderServerPage(CourseCommentsPage, params())).rejects.toThrow();
    expect(unanswered).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is not a course", async () => {
    await expect(renderServerPage(CourseCommentsPage, params("not-an-id"))).rejects.toThrow();
    courseById.mockResolvedValue(null);
    await expect(renderServerPage(CourseCommentsPage, params())).rejects.toThrow();
  });

  it("starts on unanswered questions, with Moderation as the other tab, and says when nothing is waiting", async () => {
    await renderServerPage(CourseCommentsPage, params());
    expect(screen.getByRole("heading", { name: "Comments" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Unanswered questions", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Moderation" })).toBeInTheDocument();
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
    expect(within(rows[0]).getByRole("link", { name: "Voice" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/les_AAAAAAAAAAA1?comment=cmnt_AAAAAAAAAAA1");
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

  it("marks a question handled, then refreshes and records the action without any text", async () => {
    unanswered.mockResolvedValue([question("cmnt_AAAAAAAAAAA1", "Voice", "Ada Example", "No answer needed", "2027-01-01T12:00:00.000Z")]);
    await renderServerPage(CourseCommentsPage, params());

    await userEvent.click(screen.getByRole("button", { name: "Mark handled" }));

    await waitFor(() => expect(actions.markLessonCommentHandled).toHaveBeenCalledWith(COURSE, "cmnt_AAAAAAAAAAA1"));
    expect(await screen.findByText("Marked handled")).toBeInTheDocument();
    expect(routerMock.refresh).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("lesson_comment_moderated", { course_id: COURSE, action: "handle", from: "unanswered" });
    expect(JSON.stringify(track.mock.calls)).not.toContain("No answer needed");
  });

  it("shows an error from the action and does not refresh", async () => {
    actions.hideLessonComment.mockResolvedValue({ error: "Not authorized" });
    unanswered.mockResolvedValue([question("cmnt_AAAAAAAAAAA1", "Voice", "Ada Example", "Hi", "2027-01-01T12:00:00.000Z")]);
    await renderServerPage(CourseCommentsPage, params());

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
    expect(routerMock.refresh).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});

describe("admin course comments moderation page", () => {
  it("checks for an admin first", async () => {
    requirePermission.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(renderServerPage(CourseCommentsModerationPage, params())).rejects.toThrow();
    expect(openReports).not.toHaveBeenCalled();
  });

  it("opens on the Moderation tab and says when there is nothing to review", async () => {
    await renderServerPage(CourseCommentsModerationPage, params());
    expect(screen.getByRole("tab", { name: "Moderation", selected: true })).toBeInTheDocument();
    expect(screen.getByText("No open reports.")).toBeInTheDocument();
    expect(screen.getByText("Nothing held.")).toBeInTheDocument();
  });

  it("lists reported comments with counts and reasons as typed, and no reporter names", async () => {
    openReports.mockResolvedValue([reported("cmnt_AAAAAAAAAAA1"), reported("cmnt_AAAAAAAAAAA2", { reportCount: 1, reasons: ["Off topic"], state: "held" })]);
    await renderServerPage(CourseCommentsModerationPage, params());

    expect(screen.getByRole("heading", { name: "Reported comments (2)" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Ada <Quill> & Co")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Spam & ads")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Voice" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/les_AAAAAAAAAAA1?comment=cmnt_AAAAAAAAAAA1");
    expect(within(rows[0]).queryByRole("button", { name: "Approve" })).toBeNull();
    // A held comment that was also reported can be approved from here.
    expect(within(rows[1]).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(rows[1]).getByText("(held for review)")).toBeInTheDocument();
  });

  it("hides, dismisses and approves, and asks before deleting", async () => {
    openReports.mockResolvedValue([reported("cmnt_AAAAAAAAAAA1")]);
    heldComments.mockResolvedValue([held("cmnt_AAAAAAAAAAA3")]);
    await renderServerPage(CourseCommentsModerationPage, params());
    const [reportRow, heldRow] = screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("columnheader").length === 0 && within(r).queryAllByRole("button").length > 0);

    await userEvent.click(within(reportRow).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(actions.hideLessonComment).toHaveBeenCalledWith(COURSE, "cmnt_AAAAAAAAAAA1"));
    await userEvent.click(within(reportRow).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(actions.dismissLessonCommentReports).toHaveBeenCalledWith(COURSE, "cmnt_AAAAAAAAAAA1"));

    await userEvent.click(within(heldRow).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(actions.approveHeldLessonComment).toHaveBeenCalledWith(COURSE, "cmnt_AAAAAAAAAAA3"));
    expect(track).toHaveBeenCalledWith("lesson_comment_moderated", { course_id: COURSE, action: "approve", from: "held" });

    await userEvent.click(within(reportRow).getByRole("button", { name: "Delete" }));
    expect(actions.deleteLessonCommentAsStaff).not.toHaveBeenCalled();
    await userEvent.click(within(reportRow).getByRole("button", { name: "Keep it" }));
    expect(actions.deleteLessonCommentAsStaff).not.toHaveBeenCalled();
    await userEvent.click(within(reportRow).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(reportRow).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(actions.deleteLessonCommentAsStaff).toHaveBeenCalledWith(COURSE, "cmnt_AAAAAAAAAAA1"));
  });

  it("says when an action found nothing to change", async () => {
    actions.dismissLessonCommentReports.mockResolvedValue({ changed: false });
    openReports.mockResolvedValue([reported("cmnt_AAAAAAAAAAA1")]);
    await renderServerPage(CourseCommentsModerationPage, params());
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Already done")).toBeInTheDocument();
  });
});

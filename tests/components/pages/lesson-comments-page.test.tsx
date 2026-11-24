// @vitest-environment jsdom
/** The comments section of the member lesson page: behind the `lesson_comments` flag, read-only in sudo, absent from staff previews. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { buildOutline, courseProgress, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
// A quiz lesson's questions come from the quiz tables (tests/lib/quiz-member.test.ts); these pages are plain lessons unless a test says otherwise.
const loadMemberQuiz = vi.fn();
vi.mock("@/lib/courses/quiz-member", () => ({ loadMemberQuiz: (...a: unknown[]) => loadMemberQuiz(...a) }));

const caller = { userId: "u", identity: { memberId: "m1", isSudo: false }, scope: { memberId: "m1", isAdminActing: false } };
vi.mock("@/lib/courses/caller", () => ({ requireCoursesPage: async () => caller }));

const loadLessonView = vi.fn();
vi.mock("@/lib/courses/member", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/courses/member")>()),
  loadLessonView: (...a: unknown[]) => loadLessonView(...a),
}));
vi.mock("@/lib/courses/address-redirect", () => ({ redirectOldCourseAddress: vi.fn() }));

const commenting = { on: false };
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: async () => [],
  effectiveMemberHasFeature: async (key: string) => key === "lesson_comments" && commenting.on,
}));
const thread = { entries: [] as unknown[], count: 0 };
const read = { previous: null as string | null, following: false };
const markRead = vi.fn(async (..._args: unknown[]) => read.previous);
const resolveNotifications = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/courses/comment-notifications", () => ({ resolveLessonCommentNotifications: (...a: unknown[]) => resolveNotifications(...a) }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: (client: never) => ({ ...actual.createRepos(client), courseComments: { threadFor: async () => thread, isFollowing: async () => read.following, markRead: (...a: unknown[]) => markRead(...a) } }) };
});
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "browser" }));
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn(async () => ({})), clearMyLessonProgress: vi.fn(async () => ({})) }));
vi.mock("@/app/(member)/courses/comment-actions", () => ({
  setLessonCommentFollow: vi.fn(async () => ({})),
  postLessonComment: vi.fn(async () => ({})),
  editLessonComment: vi.fn(async () => ({})),
  deleteLessonComment: vi.fn(async () => ({})),
}));

import LessonPage from "@/app/(member)/courses/[slug]/lessons/[lessonId]/page";

const LESSON = "les_AAAAAAAAAAA1";
const mod: OutlineModule = { id: "mod", parent_id: null, title: "Month 1", position: 1, state: "open" };
const lesson: OutlineLesson = { id: LESSON, module_id: "mod", title: "Voice", position: 1, state: "open", duration_seconds: null, thumbnail_url: null };
const outline = buildOutline([mod], [lesson]);
const course = { id: "crs_AAAAAAAAAAA1", slug: "the-ready-writer", title: "The Ready Writer", description: null };
const params = { params: Promise.resolve({ slug: "the-ready-writer", lessonId: LESSON }) };

const view = (over: Record<string, unknown> = {}) => ({
  kind: "ok",
  view: { course, access: { kind: "open", endsAt: null }, outline, completed: new Set<string>(), progress: courseProgress(outline, new Set<string>()) },
  lesson: { ...lesson, body_html: "<p>Write.</p>" },
  neighbors: { previous: null, next: null },
  completed: false,
  video: null,
  resumeSeconds: 0,
  files: [],
  ...over,
});

beforeEach(() => {
  loadMemberQuiz.mockReset().mockResolvedValue(null);
  cleanup();
  resetServerPageMocks();
  loadLessonView.mockReset();
  commenting.on = false;
  thread.entries = [];
  thread.count = 0;
  read.previous = null;
  read.following = false;
  markRead.mockClear();
  resolveNotifications.mockClear();
  caller.identity.isSudo = false;
  caller.scope.isAdminActing = false;
});

describe("lesson page comments", () => {
  it("shows nothing about comments while the flag is off", async () => {
    loadLessonView.mockResolvedValue(view());
    await renderServerPage(LessonPage, params);
    expect(screen.queryByRole("region", { name: /Comments/ })).not.toBeInTheDocument();
  });

  it("shows the thread under the lesson when the flag is on, a name's & and < as typed", async () => {
    commenting.on = true;
    thread.entries = [
      {
        comment: { id: "cmnt_AAAAAAAAAAA1", lessonId: LESSON, memberId: "m2", parentId: null, authorName: "Ada <Quill> & Co", isStaffReply: false, createdAt: "2027-03-01T12:00:00.000Z", editedAt: null, removed: false, body: "How do I start?" },
        replies: [],
      },
    ];
    thread.count = 1;
    loadLessonView.mockResolvedValue(view());
    await renderServerPage(LessonPage, params);

    const region = screen.getByRole("region", { name: "Comments (1)" });
    expect(within(region).getByText("Ada <Quill> & Co")).toBeInTheDocument();
    expect(within(region).getByText("How do I start?")).toBeInTheDocument();
  });

  it("counts what is new since the last visit, marks the thread read and its notifications resolved", async () => {
    commenting.on = true;
    read.previous = "2027-03-01T10:00:00.000Z";
    read.following = true;
    thread.entries = [
      {
        comment: { id: "cmnt_AAAAAAAAAAA1", lessonId: LESSON, memberId: "m2", parentId: null, authorName: "Bea", isStaffReply: false, createdAt: "2027-03-01T12:00:00.000Z", editedAt: null, removed: false, body: "New one", hidden: false, held: false },
        replies: [],
      },
    ];
    thread.count = 1;
    loadLessonView.mockResolvedValue(view());
    await renderServerPage(LessonPage, params);

    expect(screen.getByText("1 new since your last visit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
    expect(markRead).toHaveBeenCalledWith("m1", LESSON, expect.any(String));
    expect(resolveNotifications).toHaveBeenCalledWith(expect.anything(), "m1", LESSON);
  });

  it("says nothing is new on a first visit", async () => {
    commenting.on = true;
    thread.entries = [
      {
        comment: { id: "cmnt_AAAAAAAAAAA1", lessonId: LESSON, memberId: "m2", parentId: null, authorName: "Bea", isStaffReply: false, createdAt: "2027-03-01T12:00:00.000Z", editedAt: null, removed: false, body: "Old news", hidden: false, held: false },
        replies: [],
      },
    ];
    thread.count = 1;
    loadLessonView.mockResolvedValue(view());
    await renderServerPage(LessonPage, params);
    expect(screen.queryByText(/new since your last visit/)).not.toBeInTheDocument();
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("does not mark anything read in sudo", async () => {
    commenting.on = true;
    caller.identity.isSudo = true;
    loadLessonView.mockResolvedValue(view());
    await renderServerPage(LessonPage, params);
    expect(markRead).not.toHaveBeenCalled();
    expect(resolveNotifications).not.toHaveBeenCalled();
  });

  it("is read-only in sudo", async () => {
    commenting.on = true;
    caller.identity.isSudo = true;
    loadLessonView.mockResolvedValue(view());
    await renderServerPage(LessonPage, params);
    expect(screen.getByRole("button", { name: "Post comment" })).toBeDisabled();
    expect(screen.getByText(/Read-only while previewing/)).toBeInTheDocument();
  });

  it("is absent from a staff preview of a lesson members can't open yet", async () => {
    commenting.on = true;
    caller.scope.isAdminActing = true;
    loadLessonView.mockResolvedValue(view({ preview: true }));
    await renderServerPage(LessonPage, params);
    expect(screen.queryByRole("region", { name: /Comments/ })).not.toBeInTheDocument();
  });
});

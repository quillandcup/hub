import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: vi.fn() }));
vi.mock("@/lib/courses/member", () => ({ loadMemberCourseAccess: vi.fn(async () => ({ kind: "open" })), canOpenLessons: vi.fn(() => true) }));
vi.mock("@/lib/courses/activity", () => ({ recordLessonWatched: vi.fn() }));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons } from "@/lib/courses/member";
import { recordLessonWatched } from "@/lib/courses/activity";
import { courseRow, lessonRow } from "@/tests/helpers/course-fixtures";
import { POST } from "@/app/api/courses/watch/route";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const MEMBER = "mbr_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const OTHER_LESSON = "les_AAAAAAAAAAA2";
const MESSAGE = "msg_AAAAAAAAAAA1";
const SESSION = "10000000-0000-4000-a000-000000000001";
const SEGMENT = { id: "00000000-0000-4000-a000-000000000001", start: 0, end: 30, rate: 1, captions: null, visible: true };

const setup = (shares: { message: string; lesson: string; open?: boolean }[], draftCourse = false) => {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: "crs_AAAAAAAAAAA1", slug: "c", title: "C", is_draft: draftCourse })],
      courseLessons: [lessonRow({ id: LESSON, course_id: "crs_AAAAAAAAAAA1", title: "L", state: "open", video_id: "video_AAAAAAAAAAA1" })],
      chatMessageVideos: shares.map((s, i) => ({ id: `cmv_AAAAAAAAAAA${i}`, message_id: s.message, lesson_id: s.lesson, open_to_channel: s.open ?? false, created_at: "2026-01-01T00:00:00Z" })),
    }),
  );
};
const segments = () => (repos as Repos).courseProgress.segmentsOfVideos(["video_AAAAAAAAAAA1"]);
const post = (over: Record<string, unknown> = {}) =>
  POST(new NextRequest("http://localhost/api/courses/watch", { method: "POST", body: JSON.stringify({ lessonId: LESSON, sessionId: SESSION, segments: [SEGMENT], position: 30, viewed: true, ...over }) }));

beforeEach(() => {
  vi.mocked(canOpenLessons).mockReturnValue(true);
  vi.mocked(recordLessonWatched).mockClear();
  setup([{ message: MESSAGE, lesson: LESSON }]);
  vi.mocked(getCoursesCaller).mockResolvedValue({
    userId: "user-1",
    identity: { memberId: MEMBER, memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
    scope: { memberId: MEMBER, isAdminActing: false },
  });
});

describe("POST /api/courses/watch from a chat message", () => {
  it("stores the message on the stretches and the viewed marker, and still saves the lesson's resume position", async () => {
    const res = await post({ chatMessageId: MESSAGE });

    expect(res.status).toBe(200);
    // The in-memory rows have random ids, so their order is not the order they were saved in.
    expect((await segments()).map((s) => [s.kind, s.chat_message_id]).sort()).toEqual([
      ["viewed", MESSAGE],
      ["watched", MESSAGE],
    ]);
    expect(await (repos as Repos).courseProgress.lessonPosition(MEMBER, LESSON)).toBe(30);
  });

  it("stores no message for a view on the lesson page", async () => {
    await post();

    expect((await segments()).map((s) => s.chat_message_id)).toEqual([null, null]);
  });

  it("refuses a message that doesn't share this lesson, or doesn't exist or can't be read, and saves nothing", async () => {
    setup([{ message: MESSAGE, lesson: OTHER_LESSON }]);
    expect((await post({ chatMessageId: MESSAGE })).status).toBe(404);
    expect((await post({ chatMessageId: "msg_AAAAAAAAAAA9" })).status).toBe(404);
    expect(await segments()).toEqual([]);
  });

  it("answers 400 for a chat message id that isn't one", async () => {
    expect((await post({ chatMessageId: "nope" })).status).toBe(400);
  });

  it("saves nothing in sudo", async () => {
    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: MEMBER, memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: true },
      scope: { memberId: MEMBER, isAdminActing: false },
    });

    expect(await (await post({ chatMessageId: MESSAGE })).json()).toEqual({ saved: 0, reason: "sudo" });
    expect(await segments()).toEqual([]);
  });

  describe("a viewer without the course", () => {
    beforeEach(() => vi.mocked(canOpenLessons).mockReturnValue(false));

    it("is refused on the lesson page and on a message that isn't open to the channel", async () => {
      expect((await post()).status).toBe(403);
      expect((await post({ chatMessageId: MESSAGE })).status).toBe(403);
      expect(await segments()).toEqual([]);
    });

    it("can be recorded on a message an admin opened to the channel, with no lesson progress or activity", async () => {
      setup([{ message: MESSAGE, lesson: LESSON, open: true }]);

      expect((await post({ chatMessageId: MESSAGE })).status).toBe(200);

      expect((await segments()).map((s) => s.chat_message_id)).toEqual([MESSAGE, MESSAGE]);
      expect(await (repos as Repos).courseProgress.lessonPosition(MEMBER, LESSON)).toBeNull();
      expect(recordLessonWatched).not.toHaveBeenCalled();
    });

    it("is still refused for a draft course, and on the lesson page even when the message is open", async () => {
      setup([{ message: MESSAGE, lesson: LESSON, open: true }], true);
      expect((await post({ chatMessageId: MESSAGE })).status).toBe(403);

      setup([{ message: MESSAGE, lesson: LESSON, open: true }]);
      expect((await post()).status).toBe(403);
    });
  });
});

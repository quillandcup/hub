import { describe, expect, it, vi } from "vitest";

const { repos } = vi.hoisted(() => ({ repos: { current: null as unknown } }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos.current,
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadCourseWatchStats } from "@/lib/courses/watch-stats-data";
import { courseRow, lessonRow, segmentRow, videoRow } from "@/tests/helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const VIDEO = "video_AAAAAAAAAAA1";
const ANN = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const MSG_1 = "msg_AAAAAAAAAAA1";
const MSG_2 = "msg_AAAAAAAAAAA2";

const watched = (id: string, member: string, session: string, start: number, end: number, chat: string | null = null) =>
  segmentRow({ id, member_id: member, video_id: VIDEO, session_id: session, start_seconds: start, end_seconds: end, chat_message_id: chat });
const viewed = (id: string, member: string, session: string, chat: string | null = null) =>
  segmentRow({ id, member_id: member, video_id: VIDEO, session_id: session, kind: "viewed", start_seconds: 0, end_seconds: 0, chat_message_id: chat });

const load = (segments: ReturnType<typeof segmentRow>[]) => {
  repos.current = createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "ready-writer", title: "Ready Writer" })],
      courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Show up", state: "open", video_id: VIDEO })],
      videos: [videoRow({ id: VIDEO, status: "ready", mux_playback_id: "pb", duration_seconds: 100 })],
      videoWatchSegments: segments,
    }),
  );
  return loadCourseWatchStats({} as never, COURSE, { includeStaff: true, lessonId: LESSON });
};

describe("loadCourseWatchStats and chat views", () => {
  it("keeps what was watched in chat out of the lesson's numbers and reports it beside them", async () => {
    const data = await load([
      watched("00000000-0000-4000-a000-000000000001", ANN, "10000000-0000-4000-a000-000000000001", 0, 60),
      viewed("00000000-0000-4000-a000-000000000002", ANN, "10000000-0000-4000-a000-000000000001"),
      watched("00000000-0000-4000-a000-000000000003", BEA, "10000000-0000-4000-a000-000000000002", 0, 30, MSG_1),
      viewed("00000000-0000-4000-a000-000000000004", BEA, "10000000-0000-4000-a000-000000000002", MSG_1),
      watched("00000000-0000-4000-a000-000000000005", ANN, "10000000-0000-4000-a000-000000000003", 10, 20, MSG_2),
    ]);

    const entry = data!.lessons[0];
    expect(entry.stats).toMatchObject({ viewers: 1, plays: 1, watchedSeconds: 60 });
    expect(entry.chat?.messages).toBe(2);
    expect(entry.chat?.stats).toMatchObject({ viewers: 2, plays: 2, watchedSeconds: 40 });
    // The course totals are about the lessons too.
    expect(data!.viewers).toBe(1);
    expect(data!.watchedSeconds).toBe(60);
  });

  it("has no chat summary when nothing was watched in chat, and still reports chat when the lesson itself was never watched", async () => {
    const onlyLesson = await load([watched("00000000-0000-4000-a000-000000000001", ANN, "10000000-0000-4000-a000-000000000001", 0, 60)]);
    expect(onlyLesson!.lessons[0].chat).toBeNull();

    const onlyChat = await load([watched("00000000-0000-4000-a000-000000000001", BEA, "10000000-0000-4000-a000-000000000002", 0, 30, MSG_1)]);
    expect(onlyChat!.lessons[0].stats).toBeNull();
    expect(onlyChat!.lessons[0].chat?.stats.viewers).toBe(1);
  });
});

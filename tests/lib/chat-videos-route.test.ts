import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: vi.fn() }));
vi.mock("@/lib/courses/member", () => ({ loadMemberCourseAccess: vi.fn(), canOpenLessons: vi.fn() }));
vi.mock("@/lib/mux", () => ({ createMuxClient: vi.fn(() => ({})), signPlaybackTokens: vi.fn() }));
vi.mock("@/lib/mux-restriction.server", () => ({ restrictionIdForViewer: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ hitRateLimits: vi.fn() }));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { signPlaybackTokens } from "@/lib/mux";
import { restrictionIdForViewer } from "@/lib/mux-restriction.server";
import { hitRateLimits } from "@/lib/rate-limit";
import { GET, POST } from "@/app/api/chat/videos/[messageId]/route";

const MESSAGE = "msg_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const TOKENS = { playback: "p", poster: "s", storyboard: "b" };

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

/** The share row, a lesson and its video, each overridable: a missing row stands for what row-level security hides. */
const setup = (over: { shared?: boolean; open?: boolean; draftCourse?: boolean; lessonState?: string; videoId?: string | null; videoStatus?: string; thumbnail?: boolean | "asset"; deleted?: boolean } = {}) => {
  const { shared = true, open = false, draftCourse = false, lessonState = "open", videoId = "video_AAAAAAAAAAA1", videoStatus = "ready", thumbnail = false, deleted = false } = over;
  repos = createInMemoryRepos(
    new InMemoryDataset({
      courses: [{ id: "crs_AAAAAAAAAAA1", slug: "c", title: "The Ready Writer", is_draft: draftCourse } as never],
      chatMessages: deleted ? [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", deleted_at: "2026-01-02T00:00:00Z" } as never] : [],
      chatMessageVideos: shared ? [{ id: "cmv_AAAAAAAAAAA1", message_id: MESSAGE, lesson_id: LESSON, open_to_channel: open, created_at: "2026-01-01T00:00:00Z" }] : [],
      courseLessons: [{ id: LESSON, course_id: "crs_AAAAAAAAAAA1", title: "Show up for the page", state: lessonState, video_id: videoId, thumbnail_url: thumbnail === true ? "https://cdn.example.test/t.jpg" : null, thumbnail_asset_id: thumbnail === "asset" ? "media_AAAAAAAAAAA1" : null } as never],
      videos: [{ id: "video_AAAAAAAAAAA1", status: videoStatus, mux_playback_id: "pb123" } as never],
    }),
  );
};

const call = (messageId = MESSAGE) =>
  POST(new NextRequest("http://localhost/api/chat/videos/x", { method: "POST" }), { params: Promise.resolve({ messageId }) });

beforeEach(() => {
  setup();
  vi.mocked(getCoursesCaller).mockResolvedValue({
    userId: "user-1",
    identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
    scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false },
  });
  vi.mocked(loadMemberCourseAccess).mockResolvedValue({ kind: "open" } as never);
  vi.mocked(canOpenLessons).mockReturnValue(true);
  vi.mocked(hitRateLimits).mockResolvedValue(true);
  vi.mocked(restrictionIdForViewer).mockResolvedValue(null);
  vi.mocked(signPlaybackTokens).mockReset().mockResolvedValue(TOKENS);
});

describe("POST /api/chat/videos/[messageId]", () => {
  it("answers a malformed id with 404 and a signed-out or courses-less caller with 401", async () => {
    expect((await call("nope")).status).toBe(404);
    vi.mocked(getCoursesCaller).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("is a 404 for a deleted message, even one an admin opened to the whole channel, and mints nothing", async () => {
    setup({ deleted: true, open: true });
    expect((await call()).status).toBe(404);
    expect(signPlaybackTokens).not.toHaveBeenCalled();
  });

  it("is a 404 for a message that shares no video, or one the caller can't read", async () => {
    setup({ shared: false });
    expect((await call()).status).toBe(404);
    expect(signPlaybackTokens).not.toHaveBeenCalled();
  });

  it("mints links for a viewer with the course, with the title and without caching", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ title: "Show up for the page", lessonId: LESSON, lessonHref: `/courses/c/lessons/${LESSON}`, playbackId: "pb123", tokens: TOKENS, restricted: false, record: true, resumeSeconds: 0, completion: { completed: false } });
    expect(signPlaybackTokens).toHaveBeenCalledWith(expect.anything(), "pb123", undefined, null);
  });

  it("says to record the watching, and where to resume from the member's saved position", async () => {
    await repos.courseProgress.savePosition("mbr_AAAAAAAAAAA1", LESSON, 95);
    expect(await (await call()).json()).toMatchObject({ record: true, resumeSeconds: 95 });

    // A position barely into the video isn't worth resuming.
    await repos.courseProgress.savePosition("mbr_AAAAAAAAAAA1", LESSON, 3);
    expect(await (await call()).json()).toMatchObject({ resumeSeconds: 0 });
  });

  it("says whether watching on completes the lesson: for a viewer with the course who is being recorded, and whether it is already complete", async () => {
    expect((await (await call()).json()).completion).toEqual({ completed: false });

    await repos.courseProgress.setCompletion("mbr_AAAAAAAAAAA1", LESSON, "2026-01-01T00:00:00.000Z");
    expect((await (await call()).json()).completion).toEqual({ completed: true });
  });

  it("still plays when reading the member's progress fails: from the start, and not yet complete", async () => {
    vi.spyOn(repos.courseProgress, "lessonPosition").mockRejectedValue(new Error("db down"));
    vi.spyOn(repos.courseProgress, "completedLessonIds").mockRejectedValue(new Error("db down"));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ playbackId: "pb123", resumeSeconds: 0, completion: { completed: false } });
  });

  it("offers no completion in sudo, for a lesson only staff can open, or to a reader without the course", async () => {
    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: true },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false },
    });
    expect((await (await call()).json()).completion).toBeNull();

    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false },
    });
    setup({ lessonState: "coming_soon" });
    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: true },
    });
    expect((await (await call()).json()).completion).toBeNull();

    // Open to the whole channel, but the reader has no course: they watch, and nothing of theirs is completed.
    setup({ open: true });
    vi.mocked(canOpenLessons).mockReturnValue(false);
    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false },
    });
    expect((await (await call()).json()).completion).toBeNull();
  });

  it("says not to record in sudo or for a lesson only staff can open", async () => {
    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: true },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false },
    });
    expect(await (await call()).json()).toMatchObject({ record: false, resumeSeconds: 0 });

    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: true },
    });
    setup({ lessonState: "coming_soon" });
    expect(await (await call()).json()).toMatchObject({ record: false });
  });

  it("restricts the links by the same rule as the lesson page", async () => {
    vi.mocked(restrictionIdForViewer).mockResolvedValue("restriction-1");

    const body = await (await call()).json();

    expect(body.restricted).toBe(true);
    expect(signPlaybackTokens).toHaveBeenCalledWith(expect.anything(), "pb123", undefined, "restriction-1");
  });

  it("tells a reader without the course that the video is part of one, and mints nothing", async () => {
    vi.mocked(canOpenLessons).mockReturnValue(false);

    const res = await call();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_access" });
    expect(signPlaybackTokens).not.toHaveBeenCalled();
  });

  describe("a share an admin opened to the channel", () => {
    beforeEach(() => vi.mocked(canOpenLessons).mockReturnValue(false));

    it("lets a reader without the course play it, and says not to save their lesson progress", async () => {
      setup({ open: true });

      const res = await call();

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ playbackId: "pb123", record: true, resumeSeconds: 0, lessonHref: null });
    });

    it("still refuses a reader without the course when it isn't open to the channel", async () => {
      setup({ open: false });
      expect((await call()).status).toBe(403);
    });

    it("never opens a lesson that isn't open to members yet, or a course that is still a draft", async () => {
      // A lesson not open to members is a plain 404 for them, as before (the share being open changes nothing).
      setup({ open: true, lessonState: "coming_soon" });
      expect((await call()).status).toBe(404);
      setup({ open: true, draftCourse: true });
      expect((await call()).status).toBe(403);
      expect(signPlaybackTokens).not.toHaveBeenCalled();
    });
  });

  it("is a 404 for a lesson that isn't open to members, unless staff are acting as themselves", async () => {
    setup({ lessonState: "coming_soon" });
    expect((await call()).status).toBe(404);

    vi.mocked(getCoursesCaller).mockResolvedValue({
      userId: "user-1",
      identity: { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false },
      scope: { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: true },
    });
    expect((await call()).status).toBe(200);
  });

  it("is a 404 when the lesson has no video or its video isn't ready", async () => {
    setup({ videoId: null });
    expect((await call()).status).toBe(404);
    setup({ videoStatus: "preparing" });
    expect((await call()).status).toBe(404);
  });

  it("limits how often one member opens videos", async () => {
    vi.mocked(hitRateLimits).mockResolvedValue(false);

    const res = await call();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
  });

  it("answers 502 when Mux can't sign, without leaking why", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(signPlaybackTokens).mockRejectedValue(new Error("mux down"));

    const res = await call();

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("mux down");
  });
});

describe("GET /api/chat/videos/[messageId] (what the card shows before anyone presses play)", () => {
  const card = (messageId = MESSAGE) => GET(new NextRequest("http://localhost/api/chat/videos/x"), { params: Promise.resolve({ messageId }) });

  it("is a 404 for a deleted message: its card names nothing either", async () => {
    setup({ deleted: true, open: true });
    expect((await card()).status).toBe(404);
  });

  it("gives the lesson's title, its course, its thumbnail and that the viewer can watch, and mints nothing", async () => {
    setup({ thumbnail: "asset" });

    const res = await card();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ title: "Show up for the page", courseTitle: "The Ready Writer", thumbnailUrl: `/api/courses/image/lesson/${LESSON}`, lessonHref: `/courses/c/lessons/${LESSON}`, canWatch: true });
    expect(signPlaybackTokens).not.toHaveBeenCalled();
  });

  it("shows the same picture the lesson page does: our copy when the builder's choice has been copied, else the original link", async () => {
    setup({ thumbnail: true });
    expect((await (await card()).json()).thumbnailUrl).toBe("https://cdn.example.test/t.jpg");
  });

  it("has no thumbnail address for a lesson without one", async () => {
    expect((await (await card()).json()).thumbnailUrl).toBeNull();
  });

  it("says a reader without the course can't watch it, and still names it (the sharer chose to put it in that conversation)", async () => {
    vi.mocked(canOpenLessons).mockReturnValue(false);

    expect(await (await card()).json()).toMatchObject({ title: "Show up for the page", courseTitle: "The Ready Writer", canWatch: false, lessonHref: null });
  });

  it("gives no lesson address to a reader who can watch only because the share was opened to the channel", async () => {
    vi.mocked(canOpenLessons).mockReturnValue(false);
    setup({ open: true });

    expect(await (await card()).json()).toMatchObject({ canWatch: true, lessonHref: null });
  });

  it("says a reader without the course can watch it when an admin opened the share to the channel, but not for a draft course or a video that isn't ready", async () => {
    vi.mocked(canOpenLessons).mockReturnValue(false);
    setup({ open: true });
    expect((await (await card()).json()).canWatch).toBe(true);

    setup({ open: true, draftCourse: true });
    expect((await (await card()).json()).canWatch).toBe(false);

    setup({ videoStatus: "preparing" });
    vi.mocked(canOpenLessons).mockReturnValue(true);
    expect((await (await card()).json()).canWatch).toBe(false);
  });

  it("is a 404 for a malformed id, a message that shares nothing (or that the reader can't read), and a lesson not open to members; 401 signed out", async () => {
    expect((await card("nope")).status).toBe(404);
    setup({ shared: false });
    expect((await card()).status).toBe(404);
    setup({ lessonState: "coming_soon" });
    expect((await card()).status).toBe(404);
    vi.mocked(getCoursesCaller).mockResolvedValue(null);
    expect((await card()).status).toBe(401);
  });

  it("is rate limited", async () => {
    vi.mocked(hitRateLimits).mockResolvedValue(false);

    const res = await card();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
  });
});

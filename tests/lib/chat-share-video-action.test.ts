import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  hasFeature: vi.fn(),
  rpc: vi.fn(),
  sendToSlack: vi.fn(),
  connected: vi.fn(),
  coursesCaller: vi.fn(),
  canOpen: vi.fn(),
  afterCallbacks: [] as (() => Promise<void> | void)[],
  repos: { current: null as unknown },
}));

vi.mock("next/server", () => ({ after: (cb: () => Promise<void> | void) => void m.afterCallbacks.push(cb) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => m.repos.current,
}));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: (...a: unknown[]) => m.connected(...a) }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: m.coursesCaller }));
vi.mock("@/lib/courses/member", () => ({ loadMemberCourseAccess: vi.fn(async () => ({ kind: "open" })), canOpenLessons: m.canOpen }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: m.sendToSlack }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: vi.fn() }));
vi.mock("@/lib/chat/slack-edit", () => ({ updateChatMessageInSlack: vi.fn(), deleteChatMessageInSlack: vi.fn(), deleteChatFileInSlack: vi.fn() }));
vi.mock("@/lib/chat/slack-upload", () => ({ keepCopies: vi.fn() }));
vi.mock("@/lib/chat/load", () => ({}));
vi.mock("@/lib/chat/file-cleanup", () => ({ removeChatFileBytes: vi.fn() }));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { shareLessonVideoInChat } from "@/app/(member)/chat/actions";

const CHANNEL = "chn_AAAAAAAAAAC1";
const LESSON = "les_AAAAAAAAAAA1";
const POSTED = "msg_AAAAAAAAAAD1";
let dataset: InMemoryDataset;

const setLesson = (over: { state?: string; videoStatus?: string; videoId?: string | null } = {}) => {
  const { state = "open", videoStatus = "ready", videoId = "video_AAAAAAAAAAA1" } = over;
  dataset = new InMemoryDataset({
    courseLessons: [{ id: LESSON, course_id: "crs_AAAAAAAAAAA1", title: "Show up for the page", state, video_id: videoId } as never],
    videos: [{ id: "video_AAAAAAAAAAA1", status: videoStatus, mux_playback_id: "pb123" } as never],
  });
  m.repos.current = createInMemoryRepos(dataset);
};
const shared = () => (m.repos.current as Repos).chatVideos.lessonIdsOf([POSTED]);

beforeEach(() => {
  m.afterCallbacks.length = 0;
  m.getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: false });
  m.hasFeature.mockResolvedValue(true);
  m.connected.mockResolvedValue({ connected: true });
  m.coursesCaller.mockResolvedValue({ userId: "auth-1", identity: { memberId: "member-fern", isSudo: false }, scope: { memberId: "member-fern", isAdminActing: false } });
  m.canOpen.mockReturnValue(true);
  m.rpc.mockReset().mockResolvedValue({ data: POSTED, error: null });
  m.sendToSlack.mockReset();
  setLesson();
});

describe("shareLessonVideoInChat", () => {
  it("posts the message with the member's words, records the shared lesson, and sends to Slack after", async () => {
    const result = await shareLessonVideoInChat(CHANNEL, LESSON, "  This one helped me  ");

    expect(result).toEqual({ ok: true, id: POSTED });
    expect(m.rpc).toHaveBeenCalledWith("chat_post_message", expect.objectContaining({ p_channel_id: CHANNEL, p_body: "This one helped me" }));
    expect((await shared()).get(POSTED)).toBe(LESSON);
    // The row is there before the Slack send runs, so the post can carry the lesson link.
    expect(m.sendToSlack).not.toHaveBeenCalled();
    for (const cb of m.afterCallbacks) await cb();
    expect(m.sendToSlack).toHaveBeenCalledWith({ service: true }, POSTED);
  });

  it("names the lesson when the member writes nothing", async () => {
    await shareLessonVideoInChat(CHANNEL, LESSON, "   ");

    expect(m.rpc).toHaveBeenCalledWith("chat_post_message", expect.objectContaining({ p_body: "Shared a lesson video: Show up for the page" }));
  });

  it("is refused without the chat_videos feature, in sudo, or for a bad id, and posts nothing", async () => {
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_videos");
    expect(await shareLessonVideoInChat(CHANNEL, LESSON, "")).toEqual({ ok: false, error: "Sharing videos isn't available to you yet." });

    m.hasFeature.mockResolvedValue(true);
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    expect((await shareLessonVideoInChat(CHANNEL, LESSON, "")).ok).toBe(false);

    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: false });
    expect(await shareLessonVideoInChat("nope", LESSON, "")).toEqual({ ok: false, error: "Something went wrong." });
    expect(await shareLessonVideoInChat(CHANNEL, "nope", "")).toEqual({ ok: false, error: "Something went wrong." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("won't share a video the sharer can't open themselves", async () => {
    m.canOpen.mockReturnValue(false);
    expect(await shareLessonVideoInChat(CHANNEL, LESSON, "")).toEqual({ ok: false, error: "That video can't be shared." });

    m.canOpen.mockReturnValue(true);
    setLesson({ state: "coming_soon" });
    expect((await shareLessonVideoInChat(CHANNEL, LESSON, "")).ok).toBe(false);
    setLesson({ videoStatus: "preparing" });
    expect((await shareLessonVideoInChat(CHANNEL, LESSON, "")).ok).toBe(false);
    setLesson({ videoId: null });
    expect((await shareLessonVideoInChat(CHANNEL, LESSON, "")).ok).toBe(false);

    m.coursesCaller.mockResolvedValue(null);
    setLesson();
    expect((await shareLessonVideoInChat(CHANNEL, LESSON, "")).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("passes the posting error through and records nothing when the message wasn't written", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_post: not_in_channel" } });

    const result = await shareLessonVideoInChat(CHANNEL, LESSON, "");

    expect(result.ok).toBe(false);
    expect((await shared()).size).toBe(0);
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("leaves the message as text when the share row can't be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (m.repos.current as Repos).chatVideos.attach = async () => {
      throw new Error("db down");
    };

    expect(await shareLessonVideoInChat(CHANNEL, LESSON, "hi")).toEqual({ ok: true, id: POSTED });
  });
});

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
import { createInMemoryRepos } from "@/lib/data/repos";
import { sendChatMessage } from "@/app/(member)/chat/actions";
import { APP_URL } from "@/lib/config";

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

describe("sendChatMessage with a lesson address pasted in", () => {
  const ADDRESS = `${APP_URL}/courses/ready-writer/lessons/${LESSON}`;
  const ROOT = "msg_AAAAAAAAAAD9";

  it("posts the video as a card and keeps the rest of the words", async () => {
    expect(await sendChatMessage(CHANNEL, `This one helped me ${ADDRESS}`)).toEqual({ ok: true, id: POSTED });

    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("chat_post_shared_video", { p_channel_id: CHANNEL, p_body: "This one helped me", p_lesson_id: LESSON, p_open_to_channel: false, p_thread_root_id: null });
  });

  it("works in a thread, and names the lesson when only the address was sent", async () => {
    await sendChatMessage(CHANNEL, ADDRESS, ROOT);

    expect(m.rpc).toHaveBeenCalledWith("chat_post_shared_video", { p_channel_id: CHANNEL, p_body: "Shared a lesson video: Show up for the page", p_lesson_id: LESSON, p_open_to_channel: false, p_thread_root_id: ROOT });
  });

  it("opens a pasted share to the channel only for an admin acting as themselves, and only with the marker", async () => {
    m.coursesCaller.mockResolvedValue({ userId: "auth-1", identity: { memberId: "member-fern", isSudo: false }, scope: { memberId: "member-fern", isAdminActing: true } });
    await sendChatMessage(CHANNEL, `${ADDRESS}?share=open`);
    expect(m.rpc).toHaveBeenLastCalledWith("chat_post_shared_video", expect.objectContaining({ p_open_to_channel: true }));

    await sendChatMessage(CHANNEL, ADDRESS);
    expect(m.rpc).toHaveBeenLastCalledWith("chat_post_shared_video", expect.objectContaining({ p_open_to_channel: false }));

    // A member sending the same link gets an ordinary closed share (and no error), and so does an admin in sudo.
    m.coursesCaller.mockResolvedValue({ userId: "auth-1", identity: { memberId: "member-fern", isSudo: false }, scope: { memberId: "member-fern", isAdminActing: false } });
    expect(await sendChatMessage(CHANNEL, `${ADDRESS}?share=open`)).toEqual({ ok: true, id: POSTED });
    expect(m.rpc).toHaveBeenLastCalledWith("chat_post_shared_video", expect.objectContaining({ p_open_to_channel: false }));
  });

  it("leaves the address as ordinary text when the sender couldn't share that lesson", async () => {
    m.canOpen.mockReturnValue(false);
    await sendChatMessage(CHANNEL, `Look ${ADDRESS}`);
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_videos");
    await sendChatMessage(CHANNEL, `Look ${ADDRESS}`);
    setLesson({ videoStatus: "preparing" });
    m.canOpen.mockReturnValue(true);
    m.hasFeature.mockResolvedValue(true);
    await sendChatMessage(CHANNEL, `Look ${ADDRESS}`);

    expect(m.rpc).toHaveBeenCalledTimes(3);
    for (const call of m.rpc.mock.calls) {
      expect(call[0]).toBe("chat_post_message");
      expect(call[1]).toMatchObject({ p_body: `Look ${ADDRESS}` });
    }
  });

  it("leaves other addresses alone", async () => {
    await sendChatMessage(CHANNEL, "see https://elsewhere.example.org/courses/ready-writer/lessons/les_AAAAAAAAAAA1");
    await sendChatMessage(CHANNEL, "no links here");

    expect(m.rpc.mock.calls.map((c) => c[0])).toEqual(["chat_post_message", "chat_post_message"]);
  });
});

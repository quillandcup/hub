import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { APP_URL } from "@/lib/config";
import { accessRow, courseRow, lessonRow, videoRow } from "@/tests/helpers/course-fixtures";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { SLACK_LINK_MAX_AGE_MS, rewriteInSlack, shareLessonLinkBySlackTs, shareLessonLinkInMessage, shareRecentLessonLinks } from "@/lib/chat/slack-lesson-links";

const updateInSlack = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/slack-edit", () => ({ updateChatMessageInSlack: updateInSlack }));
vi.mock("@/lib/data/repos", async (orig) => ({ ...(await orig<typeof import("@/lib/data/repos")>()), createRepos: () => repos }));

const FERN = "mbr_AAAAAAAAAAA1";
const BRAMBLE = "mbr_AAAAAAAAAAA2";
const COURSE = "crs_AAAAAAAAAAA1";
const OPEN_LESSON = "les_AAAAAAAAAAA1";
const SOON_LESSON = "les_AAAAAAAAAAA2";
const NO_VIDEO_LESSON = "les_AAAAAAAAAAA3";
const CHANNEL = "chn_AAAAAAAAAAA1";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const FLAG = { feature_key: "chat_videos", enabled_globally: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };

const address = (lesson: string, query = "") => `${APP_URL}/courses/ready-writer/lessons/${lesson}${query}`;

let repos: Repos;
let dataset: InMemoryDataset;

/** Fern (a member with the course) and Bramble (an admin, no course access row) in a world where chat videos is on. */
function world(over: { flags?: object[]; access?: boolean; messages?: object[] } = {}) {
  dataset = new InMemoryDataset({
    members: [
      { id: FERN, name: "Fern Example", userId: "user-fern" },
      { id: BRAMBLE, name: "Bramble Example", userId: "user-bramble" },
    ],
    userProfiles: [
      { id: "user-fern", email: "fern@example.test", role: "member" },
      { id: "user-bramble", email: "bramble@example.test", role: "admin" },
    ],
    featureFlags: (over.flags ?? [FLAG]) as never,
    courses: [courseRow({ id: COURSE, slug: "ready-writer", title: "The Ready Writer", is_draft: false })],
    courseLessons: [
      lessonRow({ id: OPEN_LESSON, course_id: COURSE, title: "Show up", state: "open", video_id: "video_AAAAAAAAAAA1" }),
      lessonRow({ id: SOON_LESSON, course_id: COURSE, title: "Soon", state: "coming_soon", video_id: "video_AAAAAAAAAAA1" }),
      lessonRow({ id: NO_VIDEO_LESSON, course_id: COURSE, title: "Reading", state: "open", video_id: null }),
    ],
    videos: [videoRow({ id: "video_AAAAAAAAAAA1", status: "ready", mux_playback_id: "pb" })],
    courseAccess: over.access === false ? [] : [accessRow({ member_id: FERN, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z" })],
    chatChannels: [{ id: CHANNEL, slack_channel_id: "C_HOSTS" }],
    ...(over.messages ? { chatMessages: over.messages as never } : {}),
  });
  repos = createInMemoryRepos(dataset);
  return repos;
}

const message = (body: string, author: string | null = FERN, id = "msg_AAAAAAAAAAA1") => ({ id, authorMemberId: author, body });
const shared = async (id = "msg_AAAAAAAAAAA1") => (await repos.chatVideos.shareOf(id)) ?? null;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  world();
});

describe("shareLessonLinkInMessage", () => {
  it("makes the card for a member who could share the lesson themselves, closed to people without the course", async () => {
    const outcome = await shareLessonLinkInMessage(repos, message(`this helped me <${address(OPEN_LESSON)}|here>`));

    expect(outcome).toBe("shared");
    expect(await shared()).toEqual({ lessonId: OPEN_LESSON, openToChannel: false });
  });

  it("reads a bare address, a timestamp, and Slack's escaped ampersand", async () => {
    expect(await shareLessonLinkInMessage(repos, message(`${address(OPEN_LESSON, "?t=95&amp;track=1")}`))).toBe("shared");
    expect((await shared())?.lessonId).toBe(OPEN_LESSON);
  });

  it("opens the share to the conversation only when the marker comes from an admin in the Hub", async () => {
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON, "?t=5&amp;share=open"), BRAMBLE, "msg_AAAAAAAAAAA1"))).toBe("shared");
    expect(await shared("msg_AAAAAAAAAAA1")).toEqual({ lessonId: OPEN_LESSON, openToChannel: true });

    // A member sending the same marker gets an ordinary closed share.
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON, "?share=open"), FERN, "msg_AAAAAAAAAAA2"))).toBe("shared");
    expect(await shared("msg_AAAAAAAAAAA2")).toEqual({ lessonId: OPEN_LESSON, openToChannel: false });

    // An admin without the marker: closed.
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON), BRAMBLE, "msg_AAAAAAAAAAA3"))).toBe("shared");
    expect((await shared("msg_AAAAAAAAAAA3"))?.openToChannel).toBe(false);
  });

  it("lets an admin share a lesson members can't open yet, and not a member", async () => {
    expect(await shareLessonLinkInMessage(repos, message(address(SOON_LESSON), FERN))).toBe("skipped");
    expect(await shared()).toBeNull();
    expect(await shareLessonLinkInMessage(repos, message(address(SOON_LESSON), BRAMBLE, "msg_AAAAAAAAAAA2"))).toBe("shared");
    expect((await shared("msg_AAAAAAAAAAA2"))?.lessonId).toBe(SOON_LESSON);
  });

  it.each([
    ["an author who isn't a Hub member", message(`${address(OPEN_LESSON)}`, null)],
    ["another site's address", message("https://elsewhere.example.org/courses/ready-writer/lessons/les_AAAAAAAAAAA1")],
    ["no lesson address", message("just a message")],
    ["a lesson without a video", message(address(NO_VIDEO_LESSON))],
    ["a lesson that isn't there", message(address("les_AAAAAAAAAAA9"))],
  ])("leaves %s as a plain link", async (_name, msg) => {
    expect(await shareLessonLinkInMessage(repos, msg)).toBe("skipped");
    expect(await shared()).toBeNull();
  });

  it("leaves it alone for a member without the course, and when chat videos isn't on for the author", async () => {
    world({ access: false });
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON)))).toBe("skipped");

    world({ flags: [] });
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON)))).toBe("skipped");
    expect(await shared()).toBeNull();
  });

  it("is safe to run again: a message that already has its video is left as it is", async () => {
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON)))).toBe("shared");
    expect(await shareLessonLinkInMessage(repos, message(address(OPEN_LESSON, "?share=open"), BRAMBLE))).toBe("skipped");
    expect((await shared())?.openToChannel).toBe(false);
  });
});

describe("shareLessonLinkBySlackTs (the webhook's path)", () => {
  const stored = (extra: object = {}) =>
    world({ messages: [{ id: "msg_AAAAAAAAAAA1", channel_id: CHANNEL, slack_ts: "1.1", author_member_id: FERN, origin: "slack", created_at: "2026-11-10T11:00:00Z", ...extra }] });

  it("finds the message by Slack's channel and timestamp and converts it", async () => {
    stored();
    dataset.chatMessageContents.push({ message_id: "msg_AAAAAAAAAAA1", body: `<${address(OPEN_LESSON)}|watch>` });

    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1")).toBe("shared");
    expect((await shared())?.lessonId).toBe(OPEN_LESSON);
  });

  it("leaves a message written in the Hub (its address was handled at send), a deleted one, and one that isn't there", async () => {
    stored({ origin: "app" });
    dataset.chatMessageContents.push({ message_id: "msg_AAAAAAAAAAA1", body: address(OPEN_LESSON) });
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1")).toBe("skipped");

    stored({ deleted_at: "2026-11-10T11:30:00Z" });
    dataset.chatMessageContents.push({ message_id: "msg_AAAAAAAAAAA1", body: address(OPEN_LESSON) });
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1")).toBe("skipped");

    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "9.9")).toBe("skipped");
    expect(await shareLessonLinkBySlackTs(repos, "C_UNKNOWN", "1.1")).toBe("skipped");
    expect(await shared()).toBeNull();
  });

  it("never throws: a failing read is logged and the message is left alone", async () => {
    stored();
    repos.chat.idBySlackChannel = async () => {
      throw new Error("db down");
    };

    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1")).toBe("skipped");
  });
});

describe("shareRecentLessonLinks (the nightly import's path)", () => {
  useFakeClock(() => NOW);
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("converts recent Slack messages the webhook missed, and leaves older ones, other text and Hub-written ones", async () => {
    world({
      messages: [
        { id: "msg_AAAAAAAAAAA1", channel_id: CHANNEL, author_member_id: FERN, origin: "slack", created_at: at(60_000) },
        { id: "msg_AAAAAAAAAAA2", channel_id: CHANNEL, author_member_id: FERN, origin: "slack", created_at: at(SLACK_LINK_MAX_AGE_MS + 60_000) },
        { id: "msg_AAAAAAAAAAA3", channel_id: CHANNEL, author_member_id: FERN, origin: "slack", created_at: at(60_000) },
        { id: "msg_AAAAAAAAAAA4", channel_id: CHANNEL, author_member_id: FERN, origin: "app", created_at: at(60_000) },
      ],
    });
    dataset.chatMessageContents.push(
      { message_id: "msg_AAAAAAAAAAA1", body: address(OPEN_LESSON) },
      { message_id: "msg_AAAAAAAAAAA2", body: address(OPEN_LESSON) },
      { message_id: "msg_AAAAAAAAAAA3", body: "no address" },
      { message_id: "msg_AAAAAAAAAAA4", body: address(OPEN_LESSON) },
    );

    const result = await shareRecentLessonLinks(repos);

    expect(result).toEqual({ shared: 1, looked: 1 });
    expect((await shared("msg_AAAAAAAAAAA1"))?.lessonId).toBe(OPEN_LESSON);
    for (const id of ["msg_AAAAAAAAAAA2", "msg_AAAAAAAAAAA3", "msg_AAAAAAAAAAA4"]) expect(await shared(id)).toBeNull();
  });

  it("counts only what it converted, and a second run converts nothing more", async () => {
    world({ messages: [{ id: "msg_AAAAAAAAAAA1", channel_id: CHANNEL, author_member_id: FERN, origin: "slack", created_at: at(60_000) }] });
    dataset.chatMessageContents.push({ message_id: "msg_AAAAAAAAAAA1", body: address(OPEN_LESSON) });

    expect((await shareRecentLessonLinks(repos)).shared).toBe(1);
    expect((await shareRecentLessonLinks(repos)).shared).toBe(0);
  });

  it("never throws", async () => {
    repos.chat.slackMessagesLinkingLessons = async () => {
      throw new Error("db down");
    };

    expect(await shareRecentLessonLinks(repos)).toEqual({ shared: 0, looked: 0 });
  });
});

describe("rewriteInSlack (the Slack copy of a converted message)", () => {
  const stored = (extra: object = {}) => {
    world({ messages: [{ id: "msg_AAAAAAAAAAA1", channel_id: CHANNEL, slack_ts: "1.1", author_member_id: FERN, origin: "slack", created_at: "2026-11-10T11:00:00Z", ...extra }] });
    dataset.chatMessageContents.push({ message_id: "msg_AAAAAAAAAAA1", body: `look <${address(OPEN_LESSON)}|here> &amp; more` });
  };
  const rewrite = rewriteInSlack({} as never);
  useFakeClock(() => NOW);

  beforeEach(() => updateInSlack.mockReset().mockResolvedValue({ ok: true }));

  it("swaps the pasted address for the Hub links, edited as the author", async () => {
    stored();
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1", rewrite)).toBe("shared");

    expect(updateInSlack).toHaveBeenCalledTimes(1);
    const [, opts] = updateInSlack.mock.calls[0];
    expect(opts.messageId).toBe("msg_AAAAAAAAAAA1");
    expect(opts.memberId).toBe(FERN);
    expect(opts.dropPreviews).toBe(true);
    expect(opts.body).toContain("look &amp; more\n<");
    expect(opts.body).toContain("|Watch it in Hub Chat>");
    expect(opts.body).not.toContain("/lessons/" + OPEN_LESSON + "|here");
  });

  it("sends just the links when the address was the whole message", async () => {
    stored();
    dataset.chatMessageContents[0].body = address(OPEN_LESSON);
    await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1", rewrite);
    expect(updateInSlack.mock.calls[0][1].body.startsWith("<")).toBe(true);
  });

  it("leaves a message with files alone (an edit would drop them)", async () => {
    stored();
    dataset.chatMessageContents[0].files = [{ id: "F1", name: "a.png", mimetype: "image/png" }] as never;
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1", rewrite)).toBe("shared");
    expect(updateInSlack).not.toHaveBeenCalled();
  });

  it("keeps the card when Slack refuses or throws", async () => {
    stored();
    updateInSlack.mockResolvedValueOnce({ ok: false, error: "Connect Slack in Settings" });
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1", rewrite)).toBe("shared");
    expect((await shared())?.lessonId).toBe(OPEN_LESSON);

    stored();
    updateInSlack.mockRejectedValueOnce(new Error("boom"));
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1", rewrite)).toBe("shared");
  });

  it("does nothing when the message did not become a card, and the nightly path rewrites too", async () => {
    stored({ author_member_id: null });
    expect(await shareLessonLinkBySlackTs(repos, "C_HOSTS", "1.1", rewrite)).toBe("skipped");
    expect(updateInSlack).not.toHaveBeenCalled();

  });

  it("rewrites from the nightly path too", async () => {
    stored();
    expect((await shareRecentLessonLinks(repos, rewrite)).shared).toBe(1);
    expect(updateInSlack).toHaveBeenCalledTimes(1);
  });
});

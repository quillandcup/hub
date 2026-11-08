import { describe, expect, it } from "vitest";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { chatMessagePath, lessonPath, sharedVideoSlackLine, stripSharedVideoLink } from "@/lib/chat/video-link";

const MESSAGE = "msg_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const CHANNEL = "chn_AAAAAAAAAAA1";
const SLACK_CHANNEL = "C_HOSTS";

const repos = (over: ConstructorParameters<typeof InMemoryDataset>[0] = {}) =>
  createInMemoryRepos(
    new InMemoryDataset({
      chatChannels: [{ id: CHANNEL, slack_channel_id: SLACK_CHANNEL }],
      courses: [{ id: "crs_AAAAAAAAAAA1", slug: "ready-writer" } as never],
      courseLessons: [{ id: LESSON, course_id: "crs_AAAAAAAAAAA1" } as never],
      chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: MESSAGE, lesson_id: LESSON, open_to_channel: false, created_at: "2026-01-01T00:00:00Z" }],
      ...over,
    }),
  );

const CHAT_LINK = `<${APP_URL}${chatMessagePath(CHANNEL, MESSAGE)}|Watch it in Hub Chat>`;
const LESSON_LINK = `<${APP_URL}${lessonPath("ready-writer", LESSON)}|Open the lesson>`;

describe("sharedVideoSlackLine", () => {
  it("links to the message in Hub Chat first, then to the lesson", async () => {
    expect(await sharedVideoSlackLine(repos(), MESSAGE, SLACK_CHANNEL)).toBe(`\n${CHAT_LINK} · ${LESSON_LINK}`);
  });

  it("leaves out the link whose target can't be found", async () => {
    expect(await sharedVideoSlackLine(repos(), MESSAGE, null)).toBe(`\n${LESSON_LINK}`);
    expect(await sharedVideoSlackLine(repos(), MESSAGE, "C_UNKNOWN")).toBe(`\n${LESSON_LINK}`);
    expect(await sharedVideoSlackLine(repos({ courseLessons: [] }), MESSAGE, SLACK_CHANNEL)).toBe(`\n${CHAT_LINK}`);
    expect(await sharedVideoSlackLine(repos({ courses: [] }), MESSAGE, SLACK_CHANNEL)).toBe(`\n${CHAT_LINK}`);
    expect(await sharedVideoSlackLine(repos({ courses: [], chatChannels: [] }), MESSAGE, SLACK_CHANNEL)).toBeNull();
  });

  it("is null for a message that shares nothing", async () => {
    expect(await sharedVideoSlackLine(repos(), "msg_AAAAAAAAAAA2", SLACK_CHANNEL)).toBeNull();
  });

  it("carries only addresses: no playback id or token", async () => {
    const line = (await sharedVideoSlackLine(repos(), MESSAGE, SLACK_CHANNEL)) as string;
    const urls = [...line.matchAll(/<([^|>]+)\|/g)].map((m) => new URL(m[1]));
    expect(urls).toHaveLength(2);
    expect(urls[0].search).toBe(`?thread=${MESSAGE}`);
    expect(urls[1].search).toBe("");
  });
});

describe("stripSharedVideoLink", () => {
  it.each([
    ["both links", `\n${CHAT_LINK} · ${LESSON_LINK}`],
    ["only the chat link", `\n${CHAT_LINK}`],
    ["only the lesson link", `\n${LESSON_LINK}`],
    ["the first version's single link", `\n<${APP_URL}${lessonPath("ready-writer", LESSON)}|Watch the video>`],
    ["trailing whitespace", `\n${CHAT_LINK} · ${LESSON_LINK}\n`],
  ])("removes the line Slack's copy of the message ends with: %s", (_name, line) => {
    expect(stripSharedVideoLink(`This one helped me${line}`)).toBe("This one helped me");
  });

  it("leaves other links and a link in the middle of the text alone", () => {
    const other = `see ${CHAT_LINK} now`;
    expect(stripSharedVideoLink(other)).toBe(other);
    expect(stripSharedVideoLink("plain")).toBe("plain");
    expect(stripSharedVideoLink("see <https://example.com/x|Watch it in Hub Chat>")).toBe("see <https://example.com/x|Watch it in Hub Chat>");
    expect(stripSharedVideoLink("a\n<https://example.com/courses/a/lessons/b|Open the lesson> and more")).toBe("a\n<https://example.com/courses/a/lessons/b|Open the lesson> and more");
  });
});

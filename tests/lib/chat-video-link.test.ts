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
const ROOT = "msg_AAAAAAAAAAA9";
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

  it("is the message's permalink, the one the Copy link option gives: the conversation with ?m=<message>", async () => {
    const line = (await sharedVideoSlackLine(repos(), MESSAGE, SLACK_CHANNEL)) as string;

    expect(line).toContain(`${APP_URL}/chat/${CHANNEL}?m=${MESSAGE}|`);
    expect(chatMessagePath(CHANNEL, MESSAGE)).toBe(`/chat/${CHANNEL}?m=${MESSAGE}`);
  });

  it("is null for a message that shares nothing", async () => {
    expect(await sharedVideoSlackLine(repos(), "msg_AAAAAAAAAAA2", SLACK_CHANNEL)).toBeNull();
  });

  it("carries only addresses: no playback id or token", async () => {
    const line = (await sharedVideoSlackLine(repos(), MESSAGE, SLACK_CHANNEL)) as string;
    const urls = [...line.matchAll(/<([^|>]+)\|/g)].map((m) => new URL(m[1]));
    expect(urls).toHaveLength(2);
    expect(urls[0].search).toBe(`?m=${MESSAGE}`);
    expect(urls[0].hash).toBe("");
    expect(urls[1].search).toBe("");
  });
});

describe("stripSharedVideoLink, the line among the text", () => {
  const line = `${CHAT_LINK} · ${LESSON_LINK}`;

  it("removes the line wherever the pasted address was, keeping the text either side", () => {
    expect(stripSharedVideoLink(`Before\n${line}\nAfter`)).toBe("Before\nAfter");
    expect(stripSharedVideoLink(`${line}\nAfter`)).toBe("After");
    expect(stripSharedVideoLink(`Before\n${line}`)).toBe("Before");
    expect(stripSharedVideoLink(`A\n${line}\nB\n${line}\nC`)).toBe("A\nB\nC");
  });

  it("drops the lesson's title line above it when there is other text, and keeps it when there is none", () => {
    const title = "Shared a lesson video: Welcome to The Ready Writer";
    expect(stripSharedVideoLink(`Before\n${title}\n${line}\nAfter`)).toBe("Before\nAfter");
    expect(stripSharedVideoLink(`${title}\n${line}\nAfter`)).toBe("After");
    expect(stripSharedVideoLink(`Before\n${title}\n${line}`)).toBe("Before");
    // The message's only text: it is what the message says, as in a share sent from the Hub.
    expect(stripSharedVideoLink(`${title}\n${line}`)).toBe(title);
    // The same words with no links line after them are the member's own text.
    expect(stripSharedVideoLink(`${title}\nmore`)).toBe(`${title}\nmore`);
  });

  it("leaves a link with another label or an address inside a sentence alone", () => {
    const text = `see ${line} for more\nnext line`;
    expect(stripSharedVideoLink(text)).toBe(text);
  });
});

describe("stripSharedVideoLink", () => {
  it.each([
    ["both links", `\n${CHAT_LINK} · ${LESSON_LINK}`],
    ["only the chat link", `\n${CHAT_LINK}`],
    ["only the lesson link", `\n${LESSON_LINK}`],
    ["the first version's single link", `\n<${APP_URL}${lessonPath("ready-writer", LESSON)}|Watch the video>`],
    ["trailing whitespace", `\n${CHAT_LINK} · ${LESSON_LINK}\n`],
    ["the earlier link shape with the thread and the anchor", `\n<${APP_URL}/chat/${CHANNEL}?thread=${ROOT}#m-${MESSAGE}|Watch it in Hub Chat> · ${LESSON_LINK}`],
    ["the earlier link shape with the thread only", `\n<${APP_URL}/chat/${CHANNEL}?thread=${MESSAGE}|Watch it in Hub Chat> · ${LESSON_LINK}`],
  ])("removes the line Slack's copy of the message ends with: %s", (_name, line) => {
    expect(stripSharedVideoLink(`This one helped me${line}`)).toBe("This one helped me");
    // A Slack message that was only a pasted address is rewritten to just the line, with nothing before it.
    expect(stripSharedVideoLink(line.replace(/^\n/, ""))).toBe("");
  });

  it("leaves other links and a link in the middle of the text alone", () => {
    const other = `see ${CHAT_LINK} now`;
    expect(stripSharedVideoLink(other)).toBe(other);
    expect(stripSharedVideoLink("plain")).toBe("plain");

    expect(stripSharedVideoLink("see <https://example.com/x|Watch it in Hub Chat>")).toBe("see <https://example.com/x|Watch it in Hub Chat>");
    expect(stripSharedVideoLink("a\n<https://example.com/courses/a/lessons/b|Open the lesson> and more")).toBe("a\n<https://example.com/courses/a/lessons/b|Open the lesson> and more");
  });
});

import { describe, expect, it } from "vitest";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { lessonPath, sharedVideoLink, stripSharedVideoLink } from "@/lib/chat/video-link";

const MESSAGE = "msg_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";

const repos = (over: ConstructorParameters<typeof InMemoryDataset>[0] = {}) =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [{ id: "crs_AAAAAAAAAAA1", slug: "ready-writer" } as never],
      courseLessons: [{ id: LESSON, course_id: "crs_AAAAAAAAAAA1" } as never],
      chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: MESSAGE, lesson_id: LESSON, open_to_channel: false, created_at: "2026-01-01T00:00:00Z" }],
      ...over,
    }),
  );

describe("sharedVideoLink", () => {
  it("is the lesson's page address for a message that shares its video", async () => {
    expect(await sharedVideoLink(repos(), MESSAGE)).toBe(`${APP_URL}${lessonPath("ready-writer", LESSON)}`);
  });

  it("is null for a message that shares nothing, or whose lesson or course is gone", async () => {
    expect(await sharedVideoLink(repos(), "msg_AAAAAAAAAAA2")).toBeNull();
    expect(await sharedVideoLink(repos({ courseLessons: [] }), MESSAGE)).toBeNull();
    expect(await sharedVideoLink(repos({ courses: [] }), MESSAGE)).toBeNull();
  });

  it("carries nothing but the lesson's address: no playback id or token", async () => {
    const link = (await sharedVideoLink(repos(), MESSAGE)) as string;
    expect(new URL(link).search).toBe("");
  });
});

describe("stripSharedVideoLink", () => {
  const line = `\n<${APP_URL}${lessonPath("ready-writer", LESSON)}|Watch the video>`;

  it("removes the line Slack's copy of the message ends with", () => {
    expect(stripSharedVideoLink(`This one helped me${line}`)).toBe("This one helped me");
    expect(stripSharedVideoLink(`Shared a lesson video: Show up${line}\n`)).toBe("Shared a lesson video: Show up");
  });

  it("leaves other links and a link in the middle of the text alone", () => {
    const other = "see <https://example.com/courses/a/lessons/b|Watch the video> now";
    expect(stripSharedVideoLink(other)).toBe(other);
    expect(stripSharedVideoLink("plain")).toBe("plain");
    expect(stripSharedVideoLink("see <https://example.com/x|Watch the video>")).toBe("see <https://example.com/x|Watch the video>");
  });
});

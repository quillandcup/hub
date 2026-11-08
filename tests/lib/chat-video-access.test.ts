import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { mayWatchSharedVideo } from "@/lib/chat/video-access";
import { courseRow } from "@/tests/helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const repos = (draft = false) => createInMemoryRepos(new InMemoryDataset({ courses: [courseRow({ id: COURSE, slug: "c", title: "C", is_draft: draft })] }));
const lesson = (state = "open") => ({ state, course_id: COURSE });

describe("mayWatchSharedVideo", () => {
  it("lets anyone with the course watch, however the video was shared", async () => {
    expect(await mayWatchSharedVideo(repos(), { openToChannel: false }, lesson("coming_soon"), true)).toBe(true);
  });

  it("keeps a video from a reader without the course unless an admin opened it to the channel", async () => {
    expect(await mayWatchSharedVideo(repos(), { openToChannel: false }, lesson(), false)).toBe(false);
    expect(await mayWatchSharedVideo(repos(), { openToChannel: true }, lesson(), false)).toBe(true);
  });

  it("never opens a lesson members can't open yet, a draft course, or a course that is gone", async () => {
    expect(await mayWatchSharedVideo(repos(), { openToChannel: true }, lesson("coming_soon"), false)).toBe(false);
    expect(await mayWatchSharedVideo(repos(true), { openToChannel: true }, lesson(), false)).toBe(false);
    expect(await mayWatchSharedVideo(createInMemoryRepos(), { openToChannel: true }, lesson(), false)).toBe(false);
  });
});

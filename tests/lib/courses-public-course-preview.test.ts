import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow } from "@/tests/helpers/course-fixtures";
import { publicCoursePreview, publicCoursePreviewById } from "@/lib/courses/public-preview";

/**
 * What anyone may see of a course without signing in: its title, a plain-text teaser of the description and
 * its cover, only for a published course whose opening date has passed, with the courses feature on for everyone.
 */
const ID = "crs_AAAAAAAAAAA1";
const NOW = new Date("2026-11-02T12:00:00Z");
const FLAG_ON = { feature_key: "courses", enabled_globally: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };

const repos = (course: Partial<Parameters<typeof courseRow>[0]> = {}, flagOn = true) =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: ID, slug: "the-ready-writer", title: "The Ready Writer", ...course })],
      featureFlags: flagOn ? [FLAG_ON] : [],
    })
  );

describe("publicCoursePreview", () => {
  it("gives a live course's title, a plain-text teaser of its description and its cover, and nothing else", async () => {
    const r = repos({ description: "<p>Write a book &amp; finish it.</p>", thumbnail_asset_id: "media_AAAAAAAAAAA1" });
    const result = await publicCoursePreview(r, "the-ready-writer", { now: NOW });
    expect(result).toEqual({
      preview: { courseId: ID, slug: "the-ready-writer", title: "The Ready Writer", excerpt: "Write a book & finish it.", thumbnailSrc: `/api/courses/image/course/${ID}` },
    });
  });

  it("falls back to Kajabi's public cover until our copy exists, and has no excerpt or cover when the course has none", async () => {
    expect(await publicCoursePreview(repos({ thumbnail_url: "https://cdn.example.test/c.jpg" }), "the-ready-writer", { now: NOW })).toMatchObject({
      preview: { thumbnailSrc: "https://cdn.example.test/c.jpg" },
    });
    expect(await publicCoursePreview(repos(), "the-ready-writer", { now: NOW })).toMatchObject({ preview: { excerpt: null, thumbnailSrc: null } });
  });

  it("drops a cover address that isn't http(s)", async () => {
    expect(await publicCoursePreview(repos({ thumbnail_url: "javascript:alert(1)" }), "the-ready-writer", { now: NOW })).toMatchObject({ preview: { thumbnailSrc: null } });
  });

  it("is blocked for an unknown course", async () => {
    expect(await publicCoursePreview(repos(), "no-such-course", { now: NOW })).toEqual({ blocked: "not_found" });
  });

  it("is blocked while the course is a draft", async () => {
    expect(await publicCoursePreview(repos({ is_draft: true }), "the-ready-writer", { now: NOW })).toEqual({ blocked: "course_not_live" });
  });

  it("is blocked until the course opens, then public from its opening date", async () => {
    const r = repos({ launch_at: "2026-11-10T00:00:00Z" });
    expect(await publicCoursePreview(r, "the-ready-writer", { now: NOW })).toEqual({ blocked: "course_not_live" });
    expect(await publicCoursePreview(r, "the-ready-writer", { now: new Date("2026-11-10T00:00:00Z") })).toHaveProperty("preview");
  });

  it("is blocked whenever the courses feature is not on for everyone", async () => {
    expect(await publicCoursePreview(repos({}, false), "the-ready-writer", { now: NOW })).toEqual({ blocked: "feature_off" });
  });
});

describe("publicCoursePreviewById", () => {
  it("applies the same rule by id, for the cover image", async () => {
    expect(await publicCoursePreviewById(repos(), ID, { now: NOW })).toHaveProperty("preview");
    expect(await publicCoursePreviewById(repos(), "crs_BBBBBBBBBBB2", { now: NOW })).toEqual({ blocked: "not_found" });
    expect(await publicCoursePreviewById(repos({ is_draft: true }), ID, { now: NOW })).toEqual({ blocked: "course_not_live" });
    expect(await publicCoursePreviewById(repos({}, false), ID, { now: NOW })).toEqual({ blocked: "feature_off" });
  });
});

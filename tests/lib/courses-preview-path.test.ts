import { describe, expect, it } from "vitest";
import { lessonPath, lessonPreviewRewrite } from "@/lib/courses/preview-path";

const LESSON = "les_AAAAAAAAAAA1";

describe("lessonPreviewRewrite", () => {
  it("maps a lesson address to its public preview", () => {
    expect(lessonPreviewRewrite(`/courses/the-ready-writer/lessons/${LESSON}`)).toBe(`/lesson-preview/the-ready-writer/${LESSON}`);
  });

  it("is null for every other path, a bad id, or a longer path", () => {
    for (const path of [
      "/courses",
      "/courses/the-ready-writer",
      "/courses/the-ready-writer/modules/mod_AAAAAAAAAAA1",
      `/courses/the-ready-writer/lessons/${LESSON}/files/file_AAAAAAAAAAA1`,
      "/courses/the-ready-writer/lessons/not-an-id",
      "/courses/the-ready-writer/lessons/les_0OIl",
      `/courses/The_Ready/lessons/${LESSON}`,
      `/courses//lessons/${LESSON}`,
      `/lesson-preview/the-ready-writer/${LESSON}`,
      "/admin/courses/k1/lessons/l1",
    ])
      expect(lessonPreviewRewrite(path), path).toBeNull();
  });
});

describe("lessonPath", () => {
  it("is the address a member opens", () => {
    expect(lessonPath("the-ready-writer", LESSON)).toBe(`/courses/the-ready-writer/lessons/${LESSON}`);
  });
});

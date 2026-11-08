import { describe, expect, it } from "vitest";
import { extractLessonLink } from "@/lib/chat/lesson-links";

const APP = "https://hub.example.com";
const LESSON = "les_AAAAAAAAAAA1";
const URL_ = `${APP}/courses/ready-writer/lessons/${LESSON}`;

describe("extractLessonLink", () => {
  it("finds a bare lesson address and returns the text without it", () => {
    expect(extractLessonLink(`This helped me ${URL_}`, APP)).toEqual({ lessonId: LESSON, body: "This helped me" });
    expect(extractLessonLink(URL_, APP)).toEqual({ lessonId: LESSON, body: "" });
    expect(extractLessonLink(`Before ${URL_} and after`, APP)).toEqual({ lessonId: LESSON, body: "Before and after" });
  });

  it("finds it as the message box stores a link, with or without a label", () => {
    expect(extractLessonLink(`Watch <${URL_}>`, APP)).toEqual({ lessonId: LESSON, body: "Watch" });
    expect(extractLessonLink(`Watch <${URL_}|Show up for the page> today`, APP)).toEqual({ lessonId: LESSON, body: "Watch today" });
  });

  it("accepts a query or fragment, such as a timestamp", () => {
    expect(extractLessonLink(`${URL_}?t=95`, APP)).toEqual({ lessonId: LESSON, body: "" });
    expect(extractLessonLink(`see <${URL_}?t=95&track=1|here>`, APP)).toEqual({ lessonId: LESSON, body: "see" });
    expect(extractLessonLink(`${URL_}#notes`, APP)?.lessonId).toBe(LESSON);
  });

  it("takes only the first lesson address and leaves the others as text", () => {
    const other = `${APP}/courses/ready-writer/lessons/les_AAAAAAAAAAA2`;
    expect(extractLessonLink(`${URL_} then ${other}`, APP)).toEqual({ lessonId: LESSON, body: `then ${other}` });
  });

  it("keeps the line structure of a longer message", () => {
    expect(extractLessonLink(`First line\n${URL_}\n\n\nLast line`, APP)).toEqual({ lessonId: LESSON, body: "First line\n\nLast line" });
  });

  it.each([
    ["another site", "https://elsewhere.example.org/courses/ready-writer/lessons/les_AAAAAAAAAAA1"],
    ["another subdomain", "https://evil.hub.example.com/courses/ready-writer/lessons/les_AAAAAAAAAAA1"],
    ["our origin with a look-alike prefix", "https://hub.example.com.evil.test/courses/ready-writer/lessons/les_AAAAAAAAAAA1"],
    ["a course page", `${APP}/courses/ready-writer`],
    ["a module page", `${APP}/courses/ready-writer/modules/mod_AAAAAAAAAAA1`],
    ["a lesson id that isn't one", `${APP}/courses/ready-writer/lessons/les_nope`],
    ["a lesson id from another table", `${APP}/courses/ready-writer/lessons/crs_AAAAAAAAAAA1`],
    ["plain text", "no links here"],
  ])("ignores %s", (_name, text) => {
    expect(extractLessonLink(text, APP)).toBeNull();
  });

  it("finds nothing when the app address can't be read", () => {
    expect(extractLessonLink(URL_, "not a url")).toBeNull();
  });
});

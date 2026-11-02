// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

import LessonViewed from "@/components/courses/LessonViewed";

beforeEach(() => track.mockClear());

describe("LessonViewed", () => {
  it("records a video lesson being opened, once", () => {
    const { rerender } = render(<LessonViewed lessonId="les_AAAAAAAAAAA1" hasVideo />);
    rerender(<LessonViewed lessonId="les_AAAAAAAAAAA1" hasVideo />);
    expect(track.mock.calls).toEqual([["course_lesson_viewed", { has_video: true }]]);
  });

  it("tells a text lesson from a video one, and records the next lesson opened", () => {
    const { rerender } = render(<LessonViewed lessonId="les_AAAAAAAAAAA1" hasVideo={false} />);
    rerender(<LessonViewed lessonId="les_AAAAAAAAAAA2" hasVideo />);
    expect(track.mock.calls).toEqual([
      ["course_lesson_viewed", { has_video: false }],
      ["course_lesson_viewed", { has_video: true }],
    ]);
  });

  it("renders nothing", () => {
    expect(render(<LessonViewed lessonId="les_AAAAAAAAAAA1" hasVideo />).container.innerHTML).toBe("");
  });
});

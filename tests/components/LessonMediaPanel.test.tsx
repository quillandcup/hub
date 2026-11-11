// @vitest-environment jsdom
/** The admin lesson page's player gets the lesson id, so a tab left open past the links' hour can fetch fresh ones. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/courses/LessonPlayer", () => ({
  default: ({ lessonId }: { lessonId?: string }) => <div data-testid="player" data-lesson-id={lessonId ?? ""} />,
}));
vi.mock("@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/VideoActions", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/FrameThumbnailButton", () => ({ default: () => null }));

import LessonMediaPanel from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonMediaPanel";

const base = {
  title: "Lesson",
  playbackId: "pb",
  tokens: { playback: "a", poster: "b", storyboard: "c" },
  posterUrl: null,
  statsHref: null,
  lessonUrl: null,
  thumbnailLink: null,
  thumbnailLinkBlocked: "",
};

afterEach(cleanup);

describe("LessonMediaPanel", () => {
  it("hands the Hub lesson id to the player", () => {
    render(<LessonMediaPanel {...base} lessonId="les_AAAAAAAAAAA1" />);
    expect(screen.getByTestId("player").dataset.lessonId).toBe("les_AAAAAAAAAAA1");
  });

  it("passes none for a lesson that isn't in the Hub", () => {
    render(<LessonMediaPanel {...base} lessonId={null} />);
    expect(screen.getByTestId("player").dataset.lessonId).toBe("");
  });
});

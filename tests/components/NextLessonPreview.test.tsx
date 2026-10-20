// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn(async () => ({})) }));

import { LessonCompletionProvider } from "@/app/(member)/courses/LessonCompletion";
import NextLessonPreview from "@/app/(member)/courses/NextLessonPreview";

type Next = { id: string; title: string; thumbnail_url?: string | null };
const next: Next = { id: "n1", title: "Lesson 3: What Promises Are You Making Your Reader?", thumbnail_url: "https://cdn.test/n1.jpg" };
const ui = (completed: boolean, nextLesson: Next | null = next) => (
  <LessonCompletionProvider lessonId="l1" initiallyCompleted={completed} readOnlyReason={null}>
    <NextLessonPreview slug="the-ready-writer" next={nextLesson} />
  </LessonCompletionProvider>
);

describe("NextLessonPreview", () => {
  it("shows nothing until the lesson is complete", () => {
    const { container } = render(ui(false));
    expect(container).toBeEmptyDOMElement();
  });

  it("encourages and previews the next lesson (thumbnail and title) once complete, linking on", () => {
    const { container } = render(ui(true));
    const card = screen.getByRole("status");

    expect(card).toHaveTextContent("Great job! Keep going!");
    expect(card).toHaveTextContent("Lesson 3: What Promises Are You Making Your Reader?");
    expect(card).toHaveAttribute("href", "/courses/the-ready-writer/lessons/n1");
    expect(card).toHaveTextContent("Next lesson");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.test/n1.jpg");
  });

  it("uses a placeholder when the next lesson has no thumbnail, and refuses an unsafe one", () => {
    const { container, rerender } = render(ui(true, { ...next, thumbnail_url: null }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span[aria-hidden='true'].aspect-video")).not.toBeNull();

    rerender(ui(true, { ...next, thumbnail_url: "javascript:alert(1)" }));
    expect(container.querySelector("img")).toBeNull();
  });

  it("says so, instead of a dead end, when there is no next lesson", () => {
    render(ui(true, null));

    expect(screen.getByRole("status")).toHaveTextContent("That's the last lesson available so far");
    expect(screen.getByRole("link", { name: "Back to the course" })).toHaveAttribute("href", "/courses/the-ready-writer");
  });
});

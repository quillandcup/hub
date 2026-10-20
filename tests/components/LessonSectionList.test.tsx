// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LessonSectionList from "@/app/(member)/courses/LessonSectionList";
import { lessonSection, buildOutline, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";

const mod: OutlineModule = { id: "w1", parent_id: null, title: "Week 1: Writing for Yourself and Your Reader", position: 1, state: "open" };
const lesson = (id: string, title: string, position: number, over: Partial<OutlineLesson> = {}): OutlineLesson => ({
  id,
  module_id: "w1",
  title,
  position,
  state: "open",
  duration_seconds: null,
  thumbnail_url: null,
  ...over,
});
const section = (lessons: OutlineLesson[]) => lessonSection(buildOutline([mod], lessons), lessons[0].id)!;

describe("LessonSectionList", () => {
  const lessons = [
    lesson("a", "Lesson 1: Reader Expectations", 1, { thumbnail_url: "https://cdn.test/a.jpg" }),
    lesson("b", "Lesson 2: Tropes and Expectations", 2),
    lesson("c", "Lesson 3: Promises", 3, { state: "coming_soon" }),
  ];

  it("heads the list with the section's title and how many lessons it has", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" />);
    const nav = screen.getByRole("navigation", { name: "Lessons in this section" });

    expect(within(nav).getByRole("heading", { name: "Week 1: Writing for Yourself and Your Reader" })).toBeInTheDocument();
    expect(within(nav).getByText("3 Lessons")).toBeInTheDocument();
  });

  it("says 1 Lesson for a section of one", () => {
    render(<LessonSectionList slug="c" section={section([lesson("a", "Only", 1)])} completed={new Set()} currentLessonId="a" />);
    expect(screen.getByText("1 Lesson")).toBeInTheDocument();
  });

  it("marks the current lesson with a ▶ and numbers the rest", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" />);
    const items = screen.getAllByRole("listitem");

    expect(items[0]).toHaveTextContent("▶");
    expect(within(items[0]).getByRole("link")).toHaveAttribute("aria-current", "page");
    expect(items[1]).toHaveTextContent("2");
    expect(items[2]).toHaveTextContent("3");
  });

  it("keeps a completed lesson's number on the left and puts a bold check on the right", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set(["b"])} currentLessonId="a" />);
    const items = screen.getAllByRole("listitem");

    // The number stays; the check is a separate, last element of the row, in the Hub's color.
    expect(items[1]).toHaveTextContent("2");
    const check = within(items[1]).getByTestId("completed-check");
    expect(check).toHaveAttribute("stroke-width", "3.5");
    expect(check.parentElement).toHaveClass("text-plum-400");
    expect(check.closest("span[aria-hidden]")).toBe(items[1].querySelector("a")!.lastElementChild);
    // Screen readers get "(completed)" in the lesson's name instead.
    expect(within(items[1]).getByRole("link", { name: /Tropes and Expectations \(completed\)/ })).toHaveAttribute("href", "/courses/c/lessons/b");
    // Lessons that aren't complete have no check.
    expect(within(items[0]).queryByTestId("completed-check")).not.toBeInTheDocument();
    expect(within(items[2]).queryByTestId("completed-check")).not.toBeInTheDocument();
  });

  it("shows the check on the current lesson too, beside its ▶, once it's complete", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set(["a"])} currentLessonId="a" />);
    const current = screen.getAllByRole("listitem")[0];

    expect(current).toHaveTextContent("▶");
    expect(within(current).getByTestId("completed-check")).toBeInTheDocument();
  });

  it("aligns a thumbnail (or a placeholder of the same size) with each title", () => {
    const { container } = render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" />);

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "https://cdn.test/a.jpg");
    expect(images[0]).toHaveAttribute("alt", "");
    // Every row has the same four columns (marker, thumbnail, title, check), so the thumbnails line up.
    for (const item of screen.getAllByRole("listitem")) {
      const row = item.className.includes("grid-cols") ? item : (item.firstElementChild as HTMLElement);
      expect(row.className).toContain("grid-cols-[1.25rem_6rem_minmax(0,1fr)_1.25rem]");
    }
  });

  it("refuses a thumbnail that isn't http(s)", () => {
    const bad = [lesson("a", "A", 1, { thumbnail_url: "javascript:alert(1)" })];
    const { container } = render(<LessonSectionList slug="c" section={section(bad)} completed={new Set()} currentLessonId="a" />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("dims a lesson that isn't released and doesn't link it, without a label; staff can open it", () => {
    const { rerender } = render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" />);
    expect(screen.queryByText(/Coming soon/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Promises/ })).not.toBeInTheDocument();
    expect(screen.getByText("Lesson 3: Promises").closest("li")).toHaveClass("opacity-50");

    rerender(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" previewComingSoon />);
    expect(screen.getByRole("link", { name: /Promises/ })).toHaveAttribute("href", "/courses/c/lessons/c");
  });

  it("offers a Next Module button, to the next module's first lesson, when there is one", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" nextModule={{ id: "w2-first" }} />);

    expect(screen.getByRole("link", { name: "Next Module" })).toHaveAttribute("href", "/courses/c/lessons/w2-first");
  });

  it("has no Next Module button in the last module", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" nextModule={null} />);

    expect(screen.queryByRole("link", { name: "Next Module" })).not.toBeInTheDocument();
  });

  it("shades the list block a step lighter than the panel around it, so where the list ends is visible", () => {
    render(<LessonSectionList slug="c" section={section(lessons)} completed={new Set()} currentLessonId="a" />);

    expect(screen.getByRole("navigation", { name: "Lessons in this section" })).toHaveClass("bg-neutral-800/60");
  });
});

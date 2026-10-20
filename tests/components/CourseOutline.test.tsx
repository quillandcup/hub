// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CourseOutline from "@/app/(member)/courses/CourseOutline";
import { buildOutline, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";

const mod = (id: string, position: number, parent_id: string | null = null, state: "open" | "coming_soon" = "open"): OutlineModule => ({ id, parent_id, title: id, position, state });
const lesson = (id: string, position: number, module_id: string | null, state: "open" | "coming_soon" = "open"): OutlineLesson => ({
  id,
  module_id,
  title: id,
  position,
  state,
  duration_seconds: null,
});

describe("CourseOutline", () => {
  const outline = buildOutline(
    [mod("Month 1", 1), mod("Week 1", 1, "Month 1"), mod("Month 2", 2, null, "coming_soon")],
    [lesson("Welcome", 1, null), lesson("Intro", 1, "Month 1"), lesson("Day 1", 1, "Week 1"), lesson("Later", 1, "Month 2", "coming_soon")]
  );

  it("shows lessons outside any module, then modules with their weeks nested under them", () => {
    render(<CourseOutline slug="c" outline={outline} completed={new Set()} canOpen />);
    const nav = screen.getByRole("navigation", { name: "Course outline" });

    expect(within(nav).getByRole("link", { name: /Welcome/ })).toHaveAttribute("href", "/courses/c/lessons/Welcome");
    expect(within(nav).getByRole("heading", { level: 2, name: "Month 1" })).toBeInTheDocument();
    expect(within(nav).getByRole("heading", { level: 3, name: "Week 1" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Day 1/ })).toBeInTheDocument();
  });

  it("marks a coming-soon module, and doesn't link its lessons", () => {
    render(<CourseOutline slug="c" outline={outline} completed={new Set()} canOpen />);
    const nav = screen.getByRole("navigation", { name: "Course outline" });

    expect(within(nav).getByRole("heading", { level: 2, name: /Month 2/ })).toHaveTextContent("Coming soon");
    expect(within(nav).queryByRole("link", { name: /Later/ })).not.toBeInTheDocument();
  });

  it("lets staff open coming-soon lessons as a preview, still marked coming soon", () => {
    render(<CourseOutline slug="c" outline={outline} completed={new Set()} canOpen previewComingSoon />);
    const nav = screen.getByRole("navigation", { name: "Course outline" });

    expect(within(nav).getByRole("link", { name: /Later.*Coming soon/ })).toHaveAttribute("href", "/courses/c/lessons/Later");
  });

  it("highlights the current lesson and shows completed ones to screen readers", () => {
    render(<CourseOutline slug="c" outline={outline} completed={new Set(["Intro"])} canOpen currentLessonId="Day 1" />);

    expect(screen.getByRole("link", { name: /Day 1/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Intro.*completed/ })).not.toHaveAttribute("aria-current");
  });

  describe("thumbnails and label", () => {
    const withThumbs = buildOutline(
      [mod("Week", 1)],
      [
        { ...lesson("a", 1, "Week"), thumbnail_url: "https://cdn.test/a.jpg" },
        { ...lesson("b", 2, "Week"), thumbnail_url: "javascript:alert(1)" },
        lesson("c", 3, "Week"),
      ]
    );

    it("shows a lesson's thumbnail beside its title when asked, and only for a safe https image", () => {
      const { container } = render(<CourseOutline slug="c" outline={withThumbs} completed={new Set()} canOpen thumbnails />);

      const images = container.querySelectorAll("img");
      expect(images).toHaveLength(1);
      expect(images[0]).toHaveAttribute("src", "https://cdn.test/a.jpg");
      expect(images[0]).toHaveAttribute("alt", "");
    });

    it("shows no thumbnails by default", () => {
      const { container } = render(<CourseOutline slug="c" outline={withThumbs} completed={new Set()} canOpen />);
      expect(container.querySelectorAll("img")).toHaveLength(0);
    });

    it("takes an accessible label for where it is used", () => {
      render(<CourseOutline slug="c" outline={withThumbs} completed={new Set()} canOpen label="Lessons in this section" />);
      expect(screen.getByRole("navigation", { name: "Lessons in this section" })).toBeInTheDocument();
    });
  });

  it("has no links at all when the lessons can't be opened", () => {
    render(<CourseOutline slug="c" outline={outline} completed={new Set()} canOpen={false} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });
});

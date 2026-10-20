import { describe, it, expect } from "vitest";
import {
  buildOutline,
  courseProgress,
  formatDuration,
  lessonContext,
  lessonNeighbors,
  lessonSection,
  type OutlineLesson,
  type OutlineModule,
} from "@/lib/courses/outline";
import { canOpenLessons, resolveCourseAccess } from "@/lib/courses/member";

const mod = (id: string, position: number, parent_id: string | null = null, state: "open" | "coming_soon" = "open"): OutlineModule => ({
  id,
  parent_id,
  title: id,
  position,
  state,
});
const lesson = (id: string, position: number, module_id: string | null, state: "open" | "coming_soon" = "open"): OutlineLesson => ({
  id,
  module_id,
  title: id,
  position,
  state,
  duration_seconds: null,
});

describe("buildOutline", () => {
  it("orders loose lessons first, then modules, each with its own lessons before its weeks", () => {
    const outline = buildOutline(
      [mod("month2", 2), mod("month1", 1), mod("week1", 1, "month1"), mod("week2", 2, "month1")],
      [
        lesson("w2a", 1, "week2"),
        lesson("w1b", 2, "week1"),
        lesson("w1a", 1, "week1"),
        lesson("m1intro", 1, "month1"),
        lesson("m2a", 1, "month2"),
        lesson("welcome", 1, null),
      ]
    );
    expect(outline.lessons.map((l) => l.id)).toEqual(["welcome", "m1intro", "w1a", "w1b", "w2a", "m2a"]);
    expect(outline.modules.map((n) => n.module.id)).toEqual(["month1", "month2"]);
    expect(outline.modules[0].children.map((n) => n.module.id)).toEqual(["week1", "week2"]);
  });

  it("breaks position ties by title, and treats a lesson with an unknown module as loose", () => {
    const outline = buildOutline([], [lesson("b", 1, "gone"), lesson("a", 1, null)]);
    expect(outline.loose.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("lessonNeighbors", () => {
  const outline = buildOutline(
    [mod("m", 1)],
    [lesson("a", 1, "m"), lesson("soon", 2, "m", "coming_soon"), lesson("b", 3, "m"), lesson("c", 4, "m")]
  );

  it("walks open lessons only, skipping Coming soon", () => {
    expect(lessonNeighbors(outline, "a")).toMatchObject({ previous: null, next: { id: "b" } });
    expect(lessonNeighbors(outline, "b")).toMatchObject({ previous: { id: "a" }, next: { id: "c" } });
    expect(lessonNeighbors(outline, "c")).toMatchObject({ previous: { id: "b" }, next: null });
  });

  it("steps through coming-soon lessons too for staff previewing", () => {
    expect(lessonNeighbors(outline, "a", { includeComingSoon: true }).next?.id).toBe("soon");
    expect(lessonNeighbors(outline, "soon", { includeComingSoon: true })).toMatchObject({ previous: { id: "a" }, next: { id: "b" } });
  });

  it("has no neighbours for a lesson that isn't open or isn't there", () => {
    expect(lessonNeighbors(outline, "soon")).toEqual({ previous: null, next: null });
    expect(lessonNeighbors(outline, "nope")).toEqual({ previous: null, next: null });
  });
});

describe("lessonSection", () => {
  const outline = buildOutline(
    [mod("Month", 1), mod("Week", 1, "Month"), mod("Week 2", 2, "Month")],
    [lesson("intro", 1, "Month"), lesson("a", 1, "Week"), lesson("soon", 2, "Week", "coming_soon"), lesson("c", 1, "Week 2"), lesson("loose", 1, null)]
  );

  it("is the module a lesson sits in, with just its own lessons", () => {
    const section = lessonSection(outline, "a")!;
    expect(section.modules.map((n) => n.module.id)).toEqual(["Week"]);
    expect(section.modules[0].lessons.map((l) => l.id)).toEqual(["a", "soon"]);
    expect(section.lessons.map((l) => l.id)).toEqual(["a", "soon"]);
    expect(section.loose).toEqual([]);
  });

  it("leaves out the module's nested modules, so a month with weeks lists only its own lessons", () => {
    const section = lessonSection(outline, "intro")!;
    expect(section.modules[0].module.id).toBe("Month");
    expect(section.modules[0].children).toEqual([]);
    expect(section.lessons.map((l) => l.id)).toEqual(["intro"]);
  });

  it("is null for a lesson outside any module, or not in the course", () => {
    expect(lessonSection(outline, "loose")).toBeNull();
    expect(lessonSection(outline, "nope")).toBeNull();
  });
});

describe("lessonContext", () => {
  const outline = buildOutline(
    [mod("Month", 1), mod("Week", 1, "Month"), mod("Later", 2, null, "coming_soon")],
    [lesson("intro", 1, "Month"), lesson("a", 1, "Week"), lesson("soon", 2, "Week", "coming_soon"), lesson("b", 3, "Week"), lesson("z", 1, "Later", "coming_soon"), lesson("loose", 1, null)]
  );

  it("gives the modules a lesson sits in, outermost first, and its place among the open lessons", () => {
    expect(lessonContext(outline, "b")).toEqual({ trail: ["Month", "Week"], position: 4, total: 4 });
    expect(lessonContext(outline, "intro")).toEqual({ trail: ["Month"], position: 2, total: 4 });
  });

  it("has an empty trail for a lesson outside any module", () => {
    expect(lessonContext(outline, "loose")).toEqual({ trail: [], position: 1, total: 4 });
  });

  it("counts a coming-soon lesson (a staff preview) among all lessons, not the open ones", () => {
    expect(lessonContext(outline, "soon")).toEqual({ trail: ["Month", "Week"], position: 4, total: 6 });
  });

  it("is null for a lesson that isn't in the course", () => {
    expect(lessonContext(outline, "nope")).toBeNull();
  });
});

describe("courseProgress", () => {
  const outline = buildOutline([mod("m", 1)], [lesson("a", 1, "m"), lesson("b", 2, "m"), lesson("soon", 3, "m", "coming_soon")]);

  it("counts only available (open) lessons", () => {
    expect(courseProgress(outline, new Set(["a"]))).toEqual({ available: 2, completed: 1, continueLessonId: "b", allDone: false });
  });

  it("starts at the first lesson when nothing is done, and flags a finished course", () => {
    expect(courseProgress(outline, new Set()).continueLessonId).toBe("a");
    const done = courseProgress(outline, new Set(["a", "b"]));
    expect(done).toMatchObject({ completed: 2, allDone: true, continueLessonId: "a" });
  });

  it("ignores completed lessons that are no longer in the course, and a course with nothing open", () => {
    expect(courseProgress(outline, new Set(["gone"])).completed).toBe(0);
    const empty = courseProgress(buildOutline([], [lesson("soon", 1, null, "coming_soon")]), new Set());
    expect(empty).toEqual({ available: 0, completed: 0, continueLessonId: null, allDone: false });
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours, and nothing for no length", () => {
    expect(formatDuration(545)).toBe("9:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("resolveCourseAccess", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("opens for current access, lifetime or dated", () => {
    expect(resolveCourseAccess({ starts_at: "2026-01-01T00:00:00Z", ends_at: null }, false, now)).toEqual({ kind: "open", endsAt: null });
    expect(resolveCourseAccess({ starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-01-01T00:00:00Z" }, false, now).kind).toBe("open");
  });

  it("is ended once ends_at has passed, upcoming before it starts, and none with no row", () => {
    expect(resolveCourseAccess({ starts_at: "2024-01-01T00:00:00Z", ends_at: "2025-01-01T00:00:00Z" }, false, now)).toEqual({
      kind: "ended",
      endsAt: "2025-01-01T00:00:00Z",
    });
    expect(resolveCourseAccess({ starts_at: "2027-01-01T00:00:00Z", ends_at: null }, false, now)).toEqual({
      kind: "upcoming",
      startsAt: "2027-01-01T00:00:00Z",
    });
    expect(resolveCourseAccess(undefined, false, now).kind).toBe("none");
  });

  it("opens everything for staff acting as themselves", () => {
    expect(resolveCourseAccess(undefined, true, now)).toEqual({ kind: "admin" });
  });

  it("opens lessons only for open and admin access", () => {
    expect(canOpenLessons({ kind: "open", endsAt: null })).toBe(true);
    expect(canOpenLessons({ kind: "admin" })).toBe(true);
    expect(canOpenLessons({ kind: "ended", endsAt: "2025-01-01T00:00:00Z" })).toBe(false);
    expect(canOpenLessons({ kind: "upcoming", startsAt: "2027-01-01T00:00:00Z" })).toBe(false);
    expect(canOpenLessons({ kind: "none" })).toBe(false);
  });
});

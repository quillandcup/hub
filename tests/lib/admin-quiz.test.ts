import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { buildQuizResults, isQuizLesson, loadAdminQuiz, loadQuizResults } from "@/lib/courses/admin-quiz";
import { buildHubOutline } from "@/lib/courses/hub-outline";
import { loadHubOutline } from "@/lib/courses/admin";
import { courseRow, lessonRow, moduleRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const KAJABI_COURSE = "crs_AAAAAAAAAAA2";
const MODULE = "mod_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const PLAIN = "les_AAAAAAAAAAA2";
const IMPORTED = "les_AAAAAAAAAAA3";
const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";

const build = () =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "c", title: "Plot Lab", source: "hub", source_key: null }), courseRow({ id: KAJABI_COURSE, slug: "k", title: "Kajabi course", source: "kajabi", source_key: "k" })],
      courseModules: [moduleRow({ id: MODULE, course_id: COURSE, title: "Week 1" })],
      courseLessons: [
        lessonRow({ id: LESSON, course_id: COURSE, module_id: MODULE, title: "Check in" }),
        lessonRow({ id: PLAIN, course_id: COURSE, module_id: MODULE, title: "Plain" }),
        lessonRow({ id: IMPORTED, course_id: KAJABI_COURSE, title: "Imported check in", source: "kajabi", source_key: "kl" }),
      ],
      members: [
        { id: ADA, name: "Ada Example", email: "ada@example.test", displayName: "Ada E." },
        { id: GRACE, name: "Grace Example", email: "grace@example.test" },
      ],
    }),
  );

describe("loadAdminQuiz", () => {
  it("loads a quiz lesson with its questions, correct answers and attempt count, for a Hub-owned lesson", async () => {
    const repos = build();
    const quiz = await repos.quizzes.createQuiz(LESSON, { passingPercent: 70 });
    await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "One?", allowsMultiple: false, options: [{ label: "Yes", isCorrect: true }, { label: "No", isCorrect: false }] });
    await repos.quizzes.recordAttempt({ quizId: quiz.id, memberId: ADA, questionCount: 1, correctCount: 1, scorePercent: 100, passed: true, answers: [] });

    const loaded = await loadAdminQuiz(repos, COURSE, LESSON);

    expect(loaded).toMatchObject({ course: { id: COURSE, title: "Plot Lab" }, lesson: { id: LESSON, title: "Check in" }, editable: true, attemptCount: 1 });
    expect(loaded?.quiz.passingPercent).toBe(70);
    expect(loaded?.questions[0].options.map((o) => [o.label, o.isCorrect])).toEqual([["Yes", true], ["No", false]]);
  });

  it("finds the course by its address as well, and marks an imported quiz as not editable", async () => {
    const repos = build();
    await repos.quizzes.createQuiz(LESSON);
    await repos.quizzes.createQuiz(IMPORTED);
    expect((await loadAdminQuiz(repos, "c", LESSON))?.course.id).toBe(COURSE);
    expect((await loadAdminQuiz(repos, KAJABI_COURSE, IMPORTED))?.editable).toBe(false);
  });

  it("is null for a plain lesson, a lesson of another course, an unknown lesson and a bad id", async () => {
    const repos = build();
    await repos.quizzes.createQuiz(LESSON);
    expect(await loadAdminQuiz(repos, COURSE, PLAIN)).toBeNull();
    expect(await loadAdminQuiz(repos, KAJABI_COURSE, LESSON)).toBeNull();
    expect(await loadAdminQuiz(repos, COURSE, "les_AAAAAAAAAAA9")).toBeNull();
    expect(await loadAdminQuiz(repos, COURSE, "nope")).toBeNull();
  });
});

describe("isQuizLesson and the outline", () => {
  it("tells a quiz lesson from a plain one, and marks it in the Hub outline", async () => {
    const repos = build();
    await repos.quizzes.createQuiz(LESSON);
    expect(await isQuizLesson(repos, LESSON)).toBe(true);
    expect(await isQuizLesson(repos, PLAIN)).toBe(false);
    const outline = await loadHubOutline(repos, COURSE);
    expect(outline.content[LESSON]).toMatchObject({ isQuiz: true });
    expect(outline.content[PLAIN]).not.toHaveProperty("isQuiz");
  });

  it("leaves isQuiz out of a built outline unless it is set", () => {
    const outline = buildHubOutline([], [{ id: LESSON, module_id: null, title: "Q", position: 1, publishing_option: "draft", hasText: false, hasVideo: false, isQuiz: true }, { id: PLAIN, module_id: null, title: "P", position: 2, publishing_option: "draft", hasText: false, hasVideo: false }]);
    expect(outline.content).toEqual({ [LESSON]: { hasText: false, hasVideo: false, isQuiz: true }, [PLAIN]: { hasText: false, hasVideo: false } });
  });
});

describe("quiz results", () => {
  it("lists every attempt newest first with the member's display name, and 'Former member' for one that's gone", async () => {
    const repos = build();
    const quiz = await repos.quizzes.createQuiz(LESSON);
    const attempt = (memberId: string, submittedAt: string, correctCount: number) => ({ quizId: quiz.id, memberId, questionCount: 2, correctCount, scorePercent: correctCount * 50, passed: correctCount === 2, submittedAt, answers: [] });
    await repos.quizzes.recordAttempt(attempt(ADA, "2027-01-01T10:00:00.000Z", 1));
    await repos.quizzes.recordAttempt(attempt(ADA, "2027-01-02T10:00:00.000Z", 2));
    await repos.quizzes.recordAttempt(attempt(GRACE, "2027-01-03T10:00:00.000Z", 0));
    await repos.quizzes.recordAttempt(attempt("mbr_AAAAAAAAAA99", "2027-01-04T10:00:00.000Z", 1));

    const rows = await loadQuizResults(repos, quiz.id);

    expect(rows.map((r) => [r.name, r.scorePercent, r.passed])).toEqual([
      ["Former member", 50, false],
      ["Grace Example", 0, false],
      ["Ada E.", 100, true],
      ["Ada E.", 50, false],
    ]);
    expect(rows[2]).toMatchObject({ memberId: ADA, correctCount: 2, questionCount: 2 });
  });

  it("builds nothing from no attempts", () => {
    expect(buildQuizResults([], [])).toEqual([]);
  });
});

// @vitest-environment jsdom
/** A quiz lesson's Questions, Settings and Results pages (staff only, they hold the right answers). Loaders mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerRoute, resetServerPageMocks } from "@/tests/helpers/server-page";
import type { AdminQuiz } from "@/lib/courses/admin-quiz";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({}) }));
const requirePermission = vi.fn(async () => ({ id: "admin-1" }));
vi.mock("@/lib/admin-auth", () => ({ requirePermission: () => requirePermission() }));
const loadAdminQuiz = vi.fn();
const loadQuizResults = vi.fn();
vi.mock("@/lib/courses/admin-quiz", () => ({ loadAdminQuiz: (...a: unknown[]) => loadAdminQuiz(...a), loadQuizResults: (...a: unknown[]) => loadQuizResults(...a) }));
vi.mock("@/app/(admin)/admin/courses/quiz-actions", () => ({ saveQuizQuestion: vi.fn(), deleteQuizQuestion: vi.fn(), reorderQuizQuestions: vi.fn(), saveQuizSettings: vi.fn(), removeQuiz: vi.fn() }));

import QuizQuestionsPage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/questions/page";
import QuizSettingsPage from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/settings/page";
import QuizResultsPage from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/results/page";

const params = { params: Promise.resolve({ id: "crs_AAAAAAAAAAA1", lessonId: "les_AAAAAAAAAAA1" }) };
const quiz = (over: Partial<AdminQuiz> = {}, settings: Partial<AdminQuiz["quiz"]> = {}): AdminQuiz => ({
  course: { id: "crs_AAAAAAAAAAA1", title: "Plot Lab" },
  lesson: { id: "les_AAAAAAAAAAA1", title: "Let's check in" },
  editable: true,
  quiz: { id: "quiz_AAAAAAAAAAA1", lessonId: "les_AAAAAAAAAAA1", passingPercent: 80, hideAnswers: false, revision: 1, sourceKey: null, ...settings },
  questions: [{ id: "qques_AAAAAAAAAAA1", quizId: "quiz_AAAAAAAAAAA1", position: 1, prompt: "How do you feel?", kind: "choice", graded: true, allowsMultiple: false, sourceKey: null, options: [{ id: "qopt_AAAAAAAAAAA1", position: 1, label: "Fine", isCorrect: true, sourceKey: null }, { id: "qopt_AAAAAAAAAAA2", position: 2, label: "Tired", isCorrect: false, sourceKey: null }] }],
  hasGradedQuestions: true,
  hasOpenQuestions: false,
  attemptCount: 0,
  ...over,
});

beforeEach(() => {
  resetServerPageMocks();
  requirePermission.mockClear();
  loadAdminQuiz.mockReset();
  loadQuizResults.mockReset();
});

describe("a quiz lesson's pages", () => {
  it("check the caller first, and are a 404 for a lesson that isn't a quiz", async () => {
    loadAdminQuiz.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => renderServerRoute(QuizQuestionsPage, params))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(requirePermission).toHaveBeenCalled();
  });

  it("show the Questions tab: the tabs, what members need to pass, and the questions", async () => {
    loadAdminQuiz.mockResolvedValue(quiz());
    await renderServerRoute(QuizQuestionsPage, params);

    expect(screen.getByRole("heading", { level: 1, name: "Let's check in" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Quiz sections" })).getByRole("link", { name: "Questions" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/Members need 80% to pass\. Members see which answers were right\./)).toBeInTheDocument();
    expect(screen.getByText("How do you feel?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add question" })).toBeInTheDocument();
  });

  it("say when a quiz has no passing grade and hides its answers", async () => {
    loadAdminQuiz.mockResolvedValue(quiz({}, { passingPercent: null, hideAnswers: true }));
    await renderServerRoute(QuizQuestionsPage, params);
    expect(screen.getByText(/No passing grade: submitting the quiz completes the lesson\. Members don't see which answers were right\./)).toBeInTheDocument();
  });

  it("show the Settings tab with the quiz's own settings", async () => {
    loadAdminQuiz.mockResolvedValue(quiz());
    await renderServerRoute(QuizSettingsPage, params);
    expect(screen.getByRole("checkbox", { name: "Set a passing grade" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Passing grade" })).toHaveValue("80");
    expect(screen.getByRole("button", { name: "Remove quiz" })).toBeInTheDocument();
  });

  it("show the Results tab with every attempt, loaded for this quiz only when asked for", async () => {
    loadAdminQuiz.mockResolvedValue(quiz());
    loadQuizResults.mockResolvedValue([{ attemptId: "qatt_AAAAAAAAAAA1", memberId: "mbr_AAAAAAAAAAA1", name: "Ada Example", submittedAt: "2027-01-05T15:30:00.000Z", scorePercent: 100, correctCount: 1, questionCount: 1, passed: true }]);
    await renderServerRoute(QuizResultsPage, params);
    expect(loadQuizResults).toHaveBeenCalledWith(expect.anything(), "quiz_AAAAAAAAAAA1");
    expect(screen.getByRole("link", { name: "Ada Example" })).toBeInTheDocument();

    loadQuizResults.mockClear();
    await renderServerRoute(QuizQuestionsPage, params);
    expect(loadQuizResults).not.toHaveBeenCalled();
  });

  it("warn that a quiz imported from Kajabi is read only", async () => {
    loadAdminQuiz.mockResolvedValue(quiz({ editable: false }));
    await renderServerRoute(QuizQuestionsPage, params);
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
    expect(screen.getByText(/imported from Kajabi, so it can't be changed here/)).toBeInTheDocument();
  });

  it("title the browser tab with the lesson first", async () => {
    loadAdminQuiz.mockResolvedValue(quiz());
    expect(await generateMetadata(params)).toEqual({ title: "Let's check in · Questions · Plot Lab · Courses" });
  });
});

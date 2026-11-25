// @vitest-environment jsdom
/** One member's attempt at a quiz, with the words and files in it (staff only). Loaders mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({}) }));
const requirePermission = vi.fn(async (_permission: string) => ({ id: "admin-1" }));
vi.mock("@/lib/admin-auth", () => ({ requirePermission: (p: string) => requirePermission(p) }));
const loadAdminQuiz = vi.fn();
const loadAttemptView = vi.fn();
vi.mock("@/lib/courses/admin-quiz", () => ({ loadAdminQuiz: (...a: unknown[]) => loadAdminQuiz(...a), loadAttemptView: (...a: unknown[]) => loadAttemptView(...a) }));

import QuizAttemptPage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/results/[attemptId]/page";

const ATTEMPT = "qatt_AAAAAAAAAAAa";
const params = (attemptId = ATTEMPT) => ({ params: Promise.resolve({ id: "crs_AAAAAAAAAAA1", lessonId: "les_AAAAAAAAAAA1", attemptId }) });
const view = {
  unlinked: [],
  result: { attemptId: ATTEMPT, memberId: "mbr_AAAAAAAAAAA1", name: "Ada Example", submittedAt: "2027-01-05T15:30:00.000Z", scorePercent: 0, correctCount: 0, questionCount: 0, passed: true },
  answers: [
    { questionId: "qques_AAAAAAAAAAA1", prompt: "What stood out?", kind: "short_answer", picked: [], correct: null, text: "The ending.\nAnd the start.", file: null },
    { questionId: "qques_AAAAAAAAAAA2", prompt: "Upload your letter", kind: "file_upload", picked: [], correct: null, text: null, file: { name: "letter.pdf", bytes: 2048 } },
    { questionId: "qques_AAAAAAAAAAA3", prompt: "Anything else", kind: "file_upload", picked: [], correct: null, text: null, file: null },
    { questionId: "qques_AAAAAAAAAAA4", prompt: "How was it?", kind: "choice", picked: ["Hard"], correct: null, text: null, file: null },
    { questionId: "qques_AAAAAAAAAAA5", prompt: "Two plus two?", kind: "choice", picked: ["4"], correct: true, text: null, file: null },
    { questionId: "qques_AAAAAAAAAAA6", prompt: "Skipped?", kind: "short_answer", picked: [], correct: null, text: null, file: null },
  ],
};

beforeEach(() => {
  resetServerPageMocks();
  requirePermission.mockClear();
  loadAdminQuiz.mockReset().mockResolvedValue({ course: { id: "crs_AAAAAAAAAAA1", title: "Plot Lab" }, lesson: { id: "les_AAAAAAAAAAA1", title: "Reflect" }, quiz: { id: "quiz_AAAAAAAAAAA1" } });
  loadAttemptView.mockReset().mockResolvedValue(view);
});

describe("a member's attempt, for staff", () => {
  it("checks the permission first and shows every answer, the file as a link through the checking route", async () => {
    await renderServerPage(QuizAttemptPage, params());
    expect(requirePermission).toHaveBeenCalledWith("courses.manage");
    expect(loadAttemptView).toHaveBeenCalledWith(expect.anything(), "quiz_AAAAAAAAAAA1", ATTEMPT);
    expect(screen.getByRole("heading", { level: 1, name: "Ada Example" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing in this attempt was scored/)).toBeInTheDocument();
    expect(screen.getByText(/The ending\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "letter.pdf" })).toHaveAttribute("href", `/api/course-quiz-answers/${ATTEMPT}/qques_AAAAAAAAAAA2`);
    expect(screen.getByText("No file")).toBeInTheDocument();
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.getByText("(not scored)")).toBeInTheDocument();
    expect(screen.getByText("(right)")).toBeInTheDocument();
    expect(screen.getAllByText("No answer").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Results of Reflect/ })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1/lessons/les_AAAAAAAAAAA1/results");
  });

  it("lists imported answers that no question matches under their own wording, the file through its place", async () => {
    loadAttemptView.mockResolvedValue({ ...view, unlinked: [{ position: 3, prompt: "Old wording", text: "Kept words", labels: ["A", "B"], file: { name: "old.pdf", bytes: 2048 } }, { position: 6, prompt: null, text: null, labels: [], file: null }] });
    await renderServerPage(QuizAttemptPage, params());
    expect(screen.getByRole("heading", { name: "Answers to questions that no longer match" })).toBeInTheDocument();
    expect(screen.getByText("Old wording")).toBeInTheDocument();
    expect(screen.getByText("Kept words")).toBeInTheDocument();
    expect(screen.getByText("A, B")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "old.pdf" })).toHaveAttribute("href", `/api/course-quiz-answers/${ATTEMPT}/pos_3`);
    expect(screen.getByText("A question without its wording")).toBeInTheDocument();
  });

  it("shows no such section when every answer matched", async () => {
    await renderServerPage(QuizAttemptPage, params());
    expect(screen.queryByRole("heading", { name: "Answers to questions that no longer match" })).not.toBeInTheDocument();
  });

  it("shows the score of an attempt that had one", async () => {
    loadAttemptView.mockResolvedValue({ ...view, result: { ...view.result, scorePercent: 50, correctCount: 1, questionCount: 2 } });
    await renderServerPage(QuizAttemptPage, params());
    expect(screen.getByText(/Score 50% \(1 of 2\)/)).toBeInTheDocument();
  });

  it("is a 404 for an id of the wrong shape, a lesson that isn't a quiz and an attempt that isn't there", async () => {
    await expect(Promise.resolve().then(() => renderServerPage(QuizAttemptPage, params("nope")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    loadAdminQuiz.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => renderServerPage(QuizAttemptPage, params()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    loadAdminQuiz.mockResolvedValue({ course: { id: "c", title: "t" }, lesson: { id: "l", title: "t" }, quiz: { id: "q" } });
    loadAttemptView.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => renderServerPage(QuizAttemptPage, params()))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("titles the browser tab with the lesson first", async () => {
    expect(await generateMetadata(params())).toEqual({ title: "Reflect · Answers · Plot Lab · Courses" });
  });
});

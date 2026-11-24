// @vitest-environment jsdom
/** The Results tab and Settings tab for a quiz with questions that are not graded. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveQuizSettings: vi.fn(), removeQuiz: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/quiz-actions", () => actions);

import QuizResultsTable from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/QuizResultsTable";
import QuizSettingsForm from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/QuizSettingsForm";
import type { QuizResultRow } from "@/lib/courses/admin-quiz";

const row = (over: Partial<QuizResultRow> = {}): QuizResultRow => ({
  attemptId: "qatt_AAAAAAAAAAAa",
  memberId: "mbr_AAAAAAAAAAA1",
  name: "Ada Example",
  submittedAt: "2027-01-05T15:30:00.000Z",
  scorePercent: 0,
  correctCount: 0,
  questionCount: 0,
  passed: true,
  importedFrom: null,
  ...over,
});

describe("QuizResultsTable for a quiz with answers in words", () => {
  it("says an attempt was not scored, and links to the member's answers", () => {
    render(<QuizResultsTable rows={[row()]} graded={false} base="/admin/courses/crs_A/lessons/les_A" canOpenAnswers />);
    expect(screen.getByText("Not scored")).toBeInTheDocument();
    expect(screen.getByText("Completed the lesson")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View answers/ })).toHaveAttribute("href", "/admin/courses/crs_A/lessons/les_A/results/qatt_AAAAAAAAAAAa");
  });

  it("marks an attempt imported from Kajabi", () => {
    render(<QuizResultsTable rows={[row({ importedFrom: "kajabi" }), row({ attemptId: "qatt_AAAAAAAAAAAb" })]} graded={false} base="/admin/x" canOpenAnswers />);
    expect(screen.getAllByText("From Kajabi")).toHaveLength(1);
  });

  it("shows no answers link for a quiz that has none to open, and a result for a scored attempt of a graded quiz", () => {
    render(<QuizResultsTable rows={[row({ scorePercent: 50, correctCount: 1, questionCount: 2, passed: false })]} graded base="/admin/x" canOpenAnswers={false} />);
    expect(screen.queryByRole("link", { name: /View answers/ })).not.toBeInTheDocument();
    expect(screen.getByText("Not passed")).toBeInTheDocument();
  });
});

describe("QuizSettingsForm for a quiz with nothing graded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says there is nothing to pass and doesn't offer a passing grade", async () => {
    const user = userEvent.setup();
    render(<QuizSettingsForm courseId="crs_A" lessonId="les_A" lessonTitle="Reflect" passingPercent={80} hideAnswers={false} hasGradedQuestions={false} editable attemptCount={0} />);
    const box = screen.getByRole("checkbox", { name: "Set a passing grade" });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText(/nothing to pass: submitting it completes the lesson/)).toBeInTheDocument();
    actions.saveQuizSettings.mockResolvedValue({ id: "les_A" });
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(actions.saveQuizSettings).toHaveBeenCalledWith("crs_A", "les_A", { passingPercent: "", hideAnswers: false });
  });

  it("explains that short answers and uploads are recorded, not scored, when a grade is set", () => {
    render(<QuizSettingsForm courseId="crs_A" lessonId="les_A" lessonTitle="Reflect" passingPercent={80} hideAnswers={false} hasGradedQuestions editable attemptCount={0} />);
    expect(screen.getByText(/Short answers and file uploads are recorded, not scored/)).toBeInTheDocument();
  });
});

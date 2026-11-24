// @vitest-environment jsdom
/** The builder's Questions tab for questions that are not graded: choosing a kind, the graded toggle, and what is saved. The actions are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveQuizQuestion: vi.fn(), deleteQuizQuestion: vi.fn(), reorderQuizQuestions: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/quiz-actions", () => actions);

import QuizQuestionsEditor, { type EditorQuestion } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/QuizQuestionsEditor";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const questions: EditorQuestion[] = [
  { id: "qques_AAAAAAAAAAA1", prompt: "What stood out?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] },
  { id: "qques_AAAAAAAAAAA2", prompt: "Upload your letter", kind: "file_upload", graded: false, allowsMultiple: false, options: [] },
  { id: "qques_AAAAAAAAAAA3", prompt: "How was it?", kind: "choice", graded: false, allowsMultiple: false, options: [{ id: "qopt_AAAAAAAAAAA1", label: "Easy", isCorrect: false }, { id: "qopt_AAAAAAAAAAA2", label: "Hard", isCorrect: false }] },
];
const show = (over: Partial<Parameters<typeof QuizQuestionsEditor>[0]> = {}) => render(<QuizQuestionsEditor courseId={COURSE} lessonId={LESSON} questions={questions} editable attemptCount={0} {...over} />);

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue({ id: "ok" });
});

describe("QuizQuestionsEditor: questions that are not graded", () => {
  it("says in words which questions are not scored", () => {
    show();
    expect(screen.getByText("Short answer, not scored")).toBeInTheDocument();
    expect(screen.getByText("File upload, not scored")).toBeInTheDocument();
    expect(screen.getByText("Choose one, not scored")).toBeInTheDocument();
    expect(screen.queryByText("Right answer")).not.toBeInTheDocument();
  });

  it("adds a short answer: no answers to fill in, saved as a question that is not graded", async () => {
    const user = userEvent.setup();
    show({ questions: [] });
    await user.click(screen.getByRole("button", { name: "Add question" }));
    const form = screen.getByRole("form", { name: "New question" });
    await user.selectOptions(within(form).getByLabelText("Type"), "short_answer");
    expect(within(form).queryByText("Answers")).not.toBeInTheDocument();
    expect(within(form).getByText(/saved, not scored, and only the member and the course team can read it/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText("Question"), "What stood out?");
    await user.click(within(form).getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(actions.saveQuizQuestion).toHaveBeenCalledWith(COURSE, LESSON, null, { prompt: "What stood out?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] }));
  });

  it("says a file upload takes one file of the allowed size", async () => {
    const user = userEvent.setup();
    show({ questions: [] });
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.selectOptions(screen.getByLabelText("Type"), "file_upload");
    expect(screen.getByText(/Members upload one file \(a document or a picture, up to 10 MB\)/)).toBeInTheDocument();
  });

  it("adds a choice question that is not graded with no right answer to mark", async () => {
    const user = userEvent.setup();
    show({ questions: [] });
    await user.click(screen.getByRole("button", { name: "Add question" }));
    const form = screen.getByRole("form", { name: "New question" });
    await user.click(within(form).getByLabelText("Graded question (counts toward the score)"));
    expect(within(form).queryByLabelText("Answer 1 is right")).not.toBeInTheDocument();
    expect(within(form).getByText(/No answer is marked right/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText("Question"), "How was it?");
    await user.type(within(form).getByLabelText("Answer 1"), "Easy");
    await user.type(within(form).getByLabelText("Answer 2"), "Hard");
    await user.click(within(form).getByRole("button", { name: "Save question" }));
    await waitFor(() =>
      expect(actions.saveQuizQuestion).toHaveBeenCalledWith(COURSE, LESSON, null, {
        prompt: "How was it?",
        kind: "choice",
        graded: false,
        allowsMultiple: false,
        options: [{ label: "Easy", isCorrect: false }, { label: "Hard", isCorrect: false }],
      }),
    );
  });

  it("can't change the kind of a question that exists", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit question 1" }));
    const form = screen.getByRole("form", { name: "Edit question 1" });
    expect(within(form).queryByLabelText("Type")).not.toBeInTheDocument();
    expect(within(form).getByText("Short answer")).toBeInTheDocument();
  });

  it("turns grading on for an ungraded choice question, starting with the first answer marked", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit question 3" }));
    const form = screen.getByRole("form", { name: "Edit question 3" });
    await user.click(within(form).getByLabelText("Graded question (counts toward the score)"));
    expect(within(form).getByLabelText("Answer 1 is right")).toBeChecked();
  });
});

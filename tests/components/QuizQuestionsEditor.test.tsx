// @vitest-environment jsdom
/** The quiz builder's Questions tab: what it shows, what it sends when a question is added, edited, moved and deleted, and what it refuses before sending. The actions are faked. */
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
const Q1 = "qques_AAAAAAAAAAA1";
const Q2 = "qques_AAAAAAAAAAA2";
const questions: EditorQuestion[] = [
  { id: Q1, prompt: "How do you feel?", allowsMultiple: false, options: [{ id: "qopt_AAAAAAAAAAA1", label: "Great", isCorrect: false }, { id: "qopt_AAAAAAAAAAA2", label: "Fine", isCorrect: true }] },
  { id: Q2, prompt: "Pick the writing days", allowsMultiple: true, options: [{ id: "qopt_AAAAAAAAAAA3", label: "Monday", isCorrect: true }, { id: "qopt_AAAAAAAAAAA4", label: "Tuesday", isCorrect: false }, { id: "qopt_AAAAAAAAAAA5", label: "Wednesday", isCorrect: true }] },
];
const show = (over: Partial<Parameters<typeof QuizQuestionsEditor>[0]> = {}) => render(<QuizQuestionsEditor courseId={COURSE} lessonId={LESSON} questions={questions} editable attemptCount={0} {...over} />);

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue({ id: "ok" });
});

describe("QuizQuestionsEditor", () => {
  it("lists the questions with how many answers to choose and which are right, in words", () => {
    show();
    const first = screen.getAllByRole("listitem")[0];
    expect(within(first).getByText("How do you feel?")).toBeInTheDocument();
    expect(within(first).getByText("Choose one")).toBeInTheDocument();
    expect(within(first).getAllByText("Right answer")).toHaveLength(1);
    const second = screen.getAllByRole("listitem")[screen.getAllByRole("listitem").findIndex((li) => within(li).queryByText("Pick the writing days") !== null)];
    expect(within(second).getByText("Choose all that apply")).toBeInTheDocument();
    expect(within(second).getAllByText("Right answer")).toHaveLength(2);
  });

  it("says when there are no questions yet", () => {
    show({ questions: [] });
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
  });

  it("adds a question: two empty answers to start, the first marked, and sends it whole", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    const form = within(screen.getByRole("form", { name: "New question" }));
    expect(form.getByRole("radio", { name: "Answer 1 is right" })).toBeChecked();
    await user.type(form.getByRole("textbox", { name: "Question" }), "What day is it?");
    await user.type(form.getByRole("textbox", { name: "Answer 1" }), "Monday");
    await user.type(form.getByRole("textbox", { name: "Answer 2" }), "Tuesday");
    await user.click(form.getByRole("button", { name: "Add answer" }));
    await user.type(form.getByRole("textbox", { name: "Answer 3" }), "Wednesday");
    await user.click(form.getByRole("radio", { name: "Answer 3 is right" }));
    await user.click(form.getByRole("button", { name: "Save question" }));

    expect(actions.saveQuizQuestion).toHaveBeenCalledWith(COURSE, LESSON, null, {
      prompt: "What day is it?",
      allowsMultiple: false,
      options: [{ label: "Monday", isCorrect: false }, { label: "Tuesday", isCorrect: false }, { label: "Wednesday", isCorrect: true }],
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("form", { name: "New question" })).not.toBeInTheDocument();
  });

  it("lets several answers be right once members may choose several, and keeps only the first when that is switched off", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    const form = within(screen.getByRole("form", { name: "New question" }));
    await user.click(form.getByRole("checkbox", { name: "Members can choose more than one answer" }));
    await user.click(form.getByRole("checkbox", { name: "Answer 2 is right" }));
    expect(form.getByRole("checkbox", { name: "Answer 1 is right" })).toBeChecked();
    expect(form.getByRole("checkbox", { name: "Answer 2 is right" })).toBeChecked();
    await user.click(form.getByRole("checkbox", { name: "Members can choose more than one answer" }));
    expect(form.getByRole("radio", { name: "Answer 1 is right" })).toBeChecked();
    expect(form.getByRole("radio", { name: "Answer 2 is right" })).not.toBeChecked();
  });

  it("refuses an incomplete question in the form's own words, without sending it", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(screen.getByRole("button", { name: "Save question" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Write the question.");
    await user.type(screen.getByRole("textbox", { name: "Question" }), "Anything?");
    await user.click(screen.getByRole("button", { name: "Save question" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give at least 2 answers to choose from.");
    expect(actions.saveQuizQuestion).not.toHaveBeenCalled();
  });

  it("keeps at least two answers and at most twelve", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getByRole("button", { name: "Remove answer 1" })).toBeDisabled();
    for (let i = 0; i < 10; i++) await user.click(screen.getByRole("button", { name: "Add answer" }));
    expect(screen.getByRole("button", { name: "Add answer" })).toBeDisabled();
    expect(screen.getAllByRole("textbox", { name: /^Answer \d+$/ })).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "Remove answer 12" }));
    expect(screen.getByRole("button", { name: "Add answer" })).toBeEnabled();
  });

  it("edits a question, sending the ids of the answers that stay", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit question 1" }));
    const form = within(screen.getByRole("form", { name: "Edit question 1" }));
    await user.clear(form.getByRole("textbox", { name: "Question" }));
    await user.type(form.getByRole("textbox", { name: "Question" }), "How are you today?");
    await user.click(form.getByRole("button", { name: "Save question" }));

    expect(actions.saveQuizQuestion).toHaveBeenCalledWith(COURSE, LESSON, Q1, {
      prompt: "How are you today?",
      allowsMultiple: false,
      options: [{ id: "qopt_AAAAAAAAAAA1", label: "Great", isCorrect: false }, { id: "qopt_AAAAAAAAAAA2", label: "Fine", isCorrect: true }],
    });
  });

  it("shows why a save was refused and keeps the form open", async () => {
    actions.saveQuizQuestion.mockResolvedValue({ error: "That has been deleted. Refresh the page." });
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit question 1" }));
    await user.click(screen.getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent("That has been deleted. Refresh the page."));
    expect(screen.getByRole("form", { name: "Edit question 1" })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("moves a question to another position with the menu, sending the whole new order", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Move question 1" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to position 2" }));
    expect(actions.reorderQuizQuestions).toHaveBeenCalledWith(COURSE, LESSON, [Q2, Q1]);
  });

  it("asks before deleting a question, then deletes it; cancelling deletes nothing", async () => {
    const user = userEvent.setup();
    show({ attemptCount: 3 });
    await user.click(screen.getByRole("button", { name: "Delete question 2" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/“Pick the writing days” will be deleted for good\./)).toBeInTheDocument();
    expect(dialog.getByText(/The answers members gave to it are deleted too; their scores stay\./)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(actions.deleteQuizQuestion).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete question 2" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete question" }));
    expect(actions.deleteQuizQuestion).toHaveBeenCalledWith(COURSE, LESSON, Q2);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("warns, once members have taken the quiz, that old scores stay", () => {
    show({ attemptCount: 1 });
    expect(screen.getByText(/Members have made 1 attempt at this quiz\. Changing questions doesn't change the scores they already got\./)).toBeInTheDocument();
  });

  it("is read only for a quiz imported from Kajabi: the questions show and nothing can be changed", () => {
    show({ editable: false });
    expect(screen.getByText(/imported from Kajabi, so it can't be changed here/)).toBeInTheDocument();
    expect(screen.getByText("How do you feel?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit question 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete question 1" })).not.toBeInTheDocument();
  });
});

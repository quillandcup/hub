// @vitest-environment jsdom
/** A member taking a quiz in the lesson page: what they see, what they send, the score, the review, retaking, and that the lesson is shown complete after a pass. The action is faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ submitQuiz: vi.fn() }));
vi.mock("@/app/(member)/courses/quiz-actions", () => actions);
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn() }));

import QuizTaker from "@/components/courses/QuizTaker";
import { LessonCompletionProvider, useLessonCompletion } from "@/components/courses/LessonCompletion";
import type { PublicQuizQuestion, QuizSubmission } from "@/lib/courses/quiz-member";

const LESSON = "les_AAAAAAAAAAA1";
const questions: PublicQuizQuestion[] = [
  { id: "qques_AAAAAAAAAAA1", prompt: "How do you feel?", kind: "choice", allowsMultiple: false, options: [{ id: "qopt_AAAAAAAAAAA1", label: "Great" }, { id: "qopt_AAAAAAAAAAA2", label: "Fine" }] },
  { id: "qques_AAAAAAAAAAA2", prompt: "Pick the writing days", kind: "choice", allowsMultiple: true, options: [{ id: "qopt_AAAAAAAAAAA3", label: "Monday" }, { id: "qopt_AAAAAAAAAAA4", label: "Tuesday" }, { id: "qopt_AAAAAAAAAAA5", label: "Wednesday" }] },
];
const submission = (over: Partial<QuizSubmission> = {}): QuizSubmission => ({ scored: true, scorePercent: 100, correctCount: 2, questionCount: 2, passed: true, passingPercent: 80, lessonComplete: true, review: null, ...over });

const Completion = () => {
  const completion = useLessonCompletion();
  return <p data-testid="completion">{completion?.completed ? "complete" : "incomplete"}</p>;
};
const show = (over: Partial<Parameters<typeof QuizTaker>[0]> = {}, wrap: (node: ReactNode) => ReactNode = (n) => n) =>
  render(<>{wrap(<QuizTaker lessonId={LESSON} questions={questions} passingPercent={80} hideAnswers={false} attempts={[]} passedBefore={false} readOnlyReason={null} timeZone="America/New_York" {...over} />)}</>);

beforeEach(() => {
  vi.clearAllMocks();
  actions.submitQuiz.mockResolvedValue({ submission: submission() });
});

describe("QuizTaker: answering", () => {
  it("shows each question with radio buttons to choose one, or checkboxes to choose all that apply", () => {
    show();
    const first = screen.getByRole("group", { name: /How do you feel\?/ });
    expect(within(first).getAllByRole("radio")).toHaveLength(2);
    expect(within(first).getByText("Choose one")).toBeInTheDocument();
    const second = screen.getByRole("group", { name: /Pick the writing days/ });
    expect(within(second).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(second).getByText("Choose all that apply")).toBeInTheDocument();
  });

  it("says what passing takes, and that a question needs exactly the right answers", () => {
    show();
    expect(screen.getByText(/Score at least 80% to pass and complete this lesson\. A question counts only when you choose exactly the right answers\./)).toBeInTheDocument();
  });

  it("says a quiz with no passing grade is completed by submitting it", () => {
    show({ passingPercent: null });
    expect(screen.getByText("Answer the questions and submit to complete this lesson.")).toBeInTheDocument();
  });

  it("counts the questions answered", async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByText("0 of 2 answered")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Fine" }));
    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Monday" }));
    await user.click(screen.getByRole("checkbox", { name: "Tuesday" }));
    await user.click(screen.getByRole("checkbox", { name: "Tuesday" }));
    expect(screen.getByText("2 of 2 answered")).toBeInTheDocument();
  });

  it("sends the picks, one option for a single-answer question and the checked ones for the other", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("radio", { name: "Great" }));
    await user.click(screen.getByRole("radio", { name: "Fine" }));
    await user.click(screen.getByRole("checkbox", { name: "Monday" }));
    await user.click(screen.getByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));

    expect(actions.submitQuiz).toHaveBeenCalledWith(LESSON, { picks: { qques_AAAAAAAAAAA1: ["qopt_AAAAAAAAAAA2"], qques_AAAAAAAAAAA2: ["qopt_AAAAAAAAAAA3", "qopt_AAAAAAAAAAA5"] }, texts: {}, files: {} });
  });

  it("works from the keyboard: arrows choose, space ticks, enter submits", async () => {
    const user = userEvent.setup();
    show();
    await user.tab();
    expect(screen.getByRole("radio", { name: "Great" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Fine" })).toBeChecked();
    await user.tab();
    expect(screen.getByRole("checkbox", { name: "Monday" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeChecked();
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");
    // Enter on a radio submits the form.
    await waitFor(() => expect(actions.submitQuiz).toHaveBeenCalledWith(LESSON, { picks: { qques_AAAAAAAAAAA1: ["qopt_AAAAAAAAAAA2"], qques_AAAAAAAAAAA2: ["qopt_AAAAAAAAAAA3"] }, texts: {}, files: {} }));
  });

  it("allows submitting with questions unanswered (they count as wrong)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(actions.submitQuiz).toHaveBeenCalledWith(LESSON, { picks: {}, texts: {}, files: {} });
  });

  it("shows the questions without a form to fill when there are none yet", () => {
    show({ questions: [] });
    expect(screen.getByText("This quiz has no questions yet. Check back soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit answers" })).not.toBeInTheDocument();
  });

  it("is off, with the reason as its hint, while viewing as a member or previewing", () => {
    show({ readOnlyReason: "Progress can't be changed while viewing as a member" });
    expect(screen.getByRole("button", { name: "Submit answers" })).toBeDisabled();
    for (const input of screen.getAllByRole("radio")) expect(input).toBeDisabled();
  });

  it("shows why a submit failed and keeps the answers", async () => {
    actions.submitQuiz.mockResolvedValue({ error: "You don't have access to this course" });
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("radio", { name: "Fine" }));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have access to this course");
    expect(screen.getByRole("radio", { name: "Fine" })).toBeChecked();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("treats a thrown action as a failure to save, not a crash", async () => {
    actions.submitQuiz.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your answers. Try again.");
  });

  it("lists the member's earlier attempts in their time zone, and says they've passed before", () => {
    show({
      passedBefore: true,
      attempts: [
        { id: "qatt_AAAAAAAAAAA2", submittedAt: "2027-01-05T03:00:00.000Z", scorePercent: 100, correctCount: 2, questionCount: 2, passed: true, importedFrom: null, openAnswers: [] },
        { id: "qatt_AAAAAAAAAAA1", submittedAt: "2027-01-04T15:00:00.000Z", scorePercent: 50, correctCount: 1, questionCount: 2, passed: false, importedFrom: null, openAnswers: [] },
      ],
    });
    expect(screen.getByText(/You've passed this quiz\. You can take it again; the lesson stays complete\./)).toBeInTheDocument();
    expect(screen.getByText("Jan 4, 2027, 10:00 PM: 100% (2 of 2), passed")).toBeInTheDocument();
    expect(screen.getByText("Jan 4, 2027, 10:00 AM: 50% (1 of 2), not passed")).toBeInTheDocument();
  });
});

describe("QuizTaker: the result", () => {
  const submitAll = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("radio", { name: "Fine" }));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
  };

  it("on a pass says so, takes focus, refreshes the page and shows the lesson complete", async () => {
    const user = userEvent.setup();
    show({}, (node) => (
      <LessonCompletionProvider lessonId={LESSON} initiallyCompleted={false} readOnlyReason={null}>
        {node}
        <Completion />
      </LessonCompletionProvider>
    ));
    expect(screen.getByTestId("completion")).toHaveTextContent("incomplete");
    await submitAll(user);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("You scored 100% (2 of 2). You passed, and this lesson is complete.");
    expect(status).toHaveFocus();
    expect(screen.getByTestId("completion")).toHaveTextContent("complete");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Submit answers" })).not.toBeInTheDocument();
  });

  it("on a fail says what is needed and leaves the lesson incomplete", async () => {
    actions.submitQuiz.mockResolvedValue({ submission: submission({ scorePercent: 50, correctCount: 1, passed: false, lessonComplete: false }) });
    const user = userEvent.setup();
    show({}, (node) => (
      <LessonCompletionProvider lessonId={LESSON} initiallyCompleted={false} readOnlyReason={null}>
        {node}
        <Completion />
      </LessonCompletionProvider>
    ));
    await submitAll(user);
    expect(await screen.findByRole("status")).toHaveTextContent("You scored 50% (1 of 2). You need 80% to pass. You can try again.");
    expect(screen.getByRole("heading", { name: "Not quite yet" })).toBeInTheDocument();
    expect(screen.getByTestId("completion")).toHaveTextContent("incomplete");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("for a quiz with no passing grade says the answers are in and the lesson is complete", async () => {
    actions.submitQuiz.mockResolvedValue({ submission: submission({ scorePercent: 0, correctCount: 0, passingPercent: null, passed: true }) });
    const user = userEvent.setup();
    show({ passingPercent: null });
    await submitAll(user);
    expect(await screen.findByRole("status")).toHaveTextContent("You scored 0% (0 of 2). Your answers are in and this lesson is complete.");
    expect(screen.getByRole("button", { name: "Take the quiz again" })).toBeInTheDocument();
  });

  it("shows which answers were right when the quiz shows them", async () => {
    actions.submitQuiz.mockResolvedValue({
      submission: submission({
        scorePercent: 50,
        correctCount: 1,
        passed: false,
        review: [
          { questionId: "qques_AAAAAAAAAAA1", correct: true, selectedOptionIds: ["qopt_AAAAAAAAAAA2"], correctOptionIds: ["qopt_AAAAAAAAAAA2"] },
          { questionId: "qques_AAAAAAAAAAA2", correct: false, selectedOptionIds: ["qopt_AAAAAAAAAAA3"], correctOptionIds: ["qopt_AAAAAAAAAAA3", "qopt_AAAAAAAAAAA5"] },
        ],
      }),
    });
    const user = userEvent.setup();
    show();
    await submitAll(user);
    await screen.findByRole("status");
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Right")).toBeInTheDocument();
    expect(within(items[0]).getByText("Your answer: Fine")).toBeInTheDocument();
    expect(within(items[1]).getByText("Not quite")).toBeInTheDocument();
    expect(within(items[1]).getByText("Your answer: Monday")).toBeInTheDocument();
    expect(within(items[1]).getByText("Right answers: Monday and Wednesday")).toBeInTheDocument();
  });

  it("shows no review, and says so, when the quiz hides its answers", async () => {
    const user = userEvent.setup();
    show({ hideAnswers: true });
    await submitAll(user);
    await screen.findByRole("status");
    expect(screen.getByText("This quiz doesn't show which answers were right.")).toBeInTheDocument();
    expect(screen.queryByText(/Right answer/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lets the member take it again from a clean form, with focus on the first question", async () => {
    const user = userEvent.setup();
    show();
    await submitAll(user);
    await user.click(await screen.findByRole("button", { name: "Take the quiz again" }));
    expect(screen.getByRole("radio", { name: "Fine" })).not.toBeChecked();
    expect(screen.getByText("0 of 2 answered")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")[0]).toHaveFocus();
  });
});

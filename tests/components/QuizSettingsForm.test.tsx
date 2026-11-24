// @vitest-environment jsdom
/** The quiz builder's Settings tab: the passing grade, hidden answers and removing the quiz. The actions are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveQuizSettings: vi.fn(), removeQuiz: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/quiz-actions", () => actions);

import QuizSettingsForm from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/QuizSettingsForm";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const show = (over: Partial<Parameters<typeof QuizSettingsForm>[0]> = {}) =>
  render(<QuizSettingsForm courseId={COURSE} lessonId={LESSON} lessonTitle="Let's check in" passingPercent={null} hideAnswers={false} editable attemptCount={0} {...over} />);

beforeEach(() => {
  vi.clearAllMocks();
  actions.saveQuizSettings.mockResolvedValue({ id: LESSON });
  actions.removeQuiz.mockResolvedValue({ id: LESSON });
});

describe("QuizSettingsForm", () => {
  it("starts with no passing grade and says what that means", () => {
    show();
    expect(screen.getByRole("checkbox", { name: "Set a passing grade" })).not.toBeChecked();
    expect(screen.getByText(/isn't graded: submitting it completes the lesson, whatever the score/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Passing grade" })).not.toBeInTheDocument();
  });

  it("turns on a passing grade at 70 percent and saves it with hidden answers", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("checkbox", { name: "Set a passing grade" }));
    expect(screen.getByRole("textbox", { name: "Passing grade" })).toHaveValue("70");
    expect(screen.getByText(/complete the lesson only when they pass/)).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Passing grade" }));
    await user.type(screen.getByRole("textbox", { name: "Passing grade" }), "85");
    await user.click(screen.getByRole("checkbox", { name: "Hide answers on the results page" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(actions.saveQuizSettings).toHaveBeenCalledWith(COURSE, LESSON, { passingPercent: "85", hideAnswers: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Settings saved.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("saves no grade when the toggle is off, even if a number was typed before", async () => {
    const user = userEvent.setup();
    show({ passingPercent: 80, hideAnswers: true });
    expect(screen.getByRole("textbox", { name: "Passing grade" })).toHaveValue("80");
    await user.click(screen.getByRole("checkbox", { name: "Set a passing grade" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(actions.saveQuizSettings).toHaveBeenCalledWith(COURSE, LESSON, { passingPercent: "", hideAnswers: true });
  });

  it("refuses a grade that isn't a whole percent from 1 to 100 without sending it", async () => {
    const user = userEvent.setup();
    show({ passingPercent: 80 });
    for (const bad of ["0", "120", "eighty", ""]) {
      await user.clear(screen.getByRole("textbox", { name: "Passing grade" }));
      if (bad) await user.type(screen.getByRole("textbox", { name: "Passing grade" }), bad);
      await user.click(screen.getByRole("button", { name: "Save settings" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Use a whole number from 1 to 100.");
    }
    expect(actions.saveQuizSettings).not.toHaveBeenCalled();
  });

  it("shows why a save was refused", async () => {
    actions.saveQuizSettings.mockResolvedValue({ error: "Couldn't save the settings." });
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the settings.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("asks before removing the quiz, saying what goes with it, then goes back to the lesson", async () => {
    const user = userEvent.setup();
    show({ attemptCount: 2 });
    await user.click(screen.getByRole("button", { name: "Remove quiz" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Remove the quiz?" })).toBeInTheDocument();
    expect(dialog.getByText(/“Let's check in” becomes a plain lesson\. Its questions are deleted, and so are the 2 attempts members made\. This can't be undone\./)).toBeInTheDocument();
    expect(actions.removeQuiz).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", { name: "Remove quiz" }));
    expect(actions.removeQuiz).toHaveBeenCalledWith(COURSE, LESSON);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/admin/courses/${COURSE}/lessons/${LESSON}`));
  });

  it("keeps the dialog open and shows the reason when removing is refused", async () => {
    actions.removeQuiz.mockResolvedValue({ error: "Couldn't remove the quiz." });
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Remove quiz" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove quiz" }));
    expect(await screen.findByText("Couldn't remove the quiz.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("is disabled, with nothing to save or remove, for a quiz imported from Kajabi", () => {
    show({ editable: false, passingPercent: 70 });
    expect(screen.getByRole("checkbox", { name: "Set a passing grade" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Passing grade" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove quiz" })).not.toBeInTheDocument();
  });
});

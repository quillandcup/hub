// @vitest-environment jsdom
/** A member answering questions that are not graded: writing a short answer, uploading a file, and seeing what they sent. The actions and the upload are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ submitQuiz: vi.fn(), prepareQuizFileUpload: vi.fn() }));
vi.mock("@/app/(member)/courses/quiz-actions", () => actions);
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: vi.fn() }));
const upload = vi.hoisted(() => ({ uploadWithProgress: vi.fn(), signedUploadUrl: vi.fn(() => "https://storage.example.test/upload") }));
vi.mock("@/lib/chat/upload-progress", () => upload);

import QuizTaker from "@/components/courses/QuizTaker";
import type { MemberAttempt, PublicQuizQuestion, QuizSubmission } from "@/lib/courses/quiz-member";

const LESSON = "les_AAAAAAAAAAA1";
const TEXT_Q = "qques_AAAAAAAAAAA1";
const FILE_Q = "qques_AAAAAAAAAAA2";
const CHOICE_Q = "qques_AAAAAAAAAAA3";
const questions: PublicQuizQuestion[] = [
  { id: TEXT_Q, prompt: "What stood out?", kind: "short_answer", allowsMultiple: false, options: [] },
  { id: FILE_Q, prompt: "Upload your letter", kind: "file_upload", allowsMultiple: false, options: [] },
  { id: CHOICE_Q, prompt: "How was it?", kind: "choice", allowsMultiple: false, options: [{ id: "qopt_AAAAAAAAAAA1", label: "Easy" }, { id: "qopt_AAAAAAAAAAA2", label: "Hard" }] },
];
const submission = (over: Partial<QuizSubmission> = {}): QuizSubmission => ({ scored: false, scorePercent: 0, correctCount: 0, questionCount: 0, passed: true, passingPercent: null, lessonComplete: true, review: null, ...over });
const show = (over: Partial<Parameters<typeof QuizTaker>[0]> = {}) =>
  render(<QuizTaker lessonId={LESSON} questions={questions} passingPercent={null} hideAnswers={false} attempts={[]} passedBefore={false} readOnlyReason={null} timeZone="America/New_York" {...over} />);
const pdf = (name = "letter.pdf", size = 2000) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  actions.submitQuiz.mockResolvedValue({ submission: submission() });
  actions.prepareQuizFileUpload.mockResolvedValue({ path: "mbr_AAAAAAAAAAA1/11111111-1111-4111-8111-111111111111/letter.pdf", token: "tokentokentoken" });
  upload.uploadWithProgress.mockResolvedValue({ ok: true });
});

describe("QuizTaker: short answer and file questions", () => {
  it("shows a text box and a file chooser, and tells the member who can read what they write", () => {
    show();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeInTheDocument();
    expect(screen.getByLabelText("File for question 2")).toBeInTheDocument();
    expect(screen.getByText("Only you and the course team can read what you write or upload here.")).toBeInTheDocument();
    expect(screen.getByText("Upload one file, up to 10 MB.")).toBeInTheDocument();
  });

  it("does not make the privacy promise for a quiz with no such question", () => {
    show({ questions: [questions[2]] });
    expect(screen.queryByText(/Only you and the course team/)).not.toBeInTheDocument();
  });

  it("sends the text and the uploaded file's path with the picks, and shows what was sent with no score", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "The ending.");
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    await screen.findByText(/letter\.pdf/);
    await user.click(screen.getByLabelText("Hard"));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => expect(actions.submitQuiz).toHaveBeenCalled());
    expect(actions.prepareQuizFileUpload).toHaveBeenCalledWith(LESSON, FILE_Q, { name: "letter.pdf", size: 2000 });
    expect(upload.uploadWithProgress).toHaveBeenCalledWith(expect.objectContaining({ contentType: "application/pdf", url: "https://storage.example.test/upload" }));
    expect(actions.submitQuiz).toHaveBeenCalledWith(LESSON, {
      picks: { [CHOICE_Q]: ["qopt_AAAAAAAAAAA2"] },
      texts: { [TEXT_Q]: "The ending." },
      files: { [FILE_Q]: { path: "mbr_AAAAAAAAAAA1/11111111-1111-4111-8111-111111111111/letter.pdf", name: "letter.pdf", bytes: 2000 } },
    });
    expect(await screen.findByText("Your answers are in and this lesson is complete.")).toBeInTheDocument();
    expect(screen.queryByText(/You scored/)).not.toBeInTheDocument();
    expect(screen.getByText("The ending.")).toBeInTheDocument();
    expect(screen.getByText("letter.pdf")).toBeInTheDocument();
  });

  it("counts a written or uploaded answer as answered", async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByText("0 of 3 answered")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "x");
    expect(screen.getByText("1 of 3 answered")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    await screen.findByText(/letter\.pdf/);
    expect(screen.getByText("2 of 3 answered")).toBeInTheDocument();
  });

  it("lets the member take the file back out, and sends none", async () => {
    const user = userEvent.setup();
    show();
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    await user.click(await screen.findByRole("button", { name: "Remove file" }));
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "x");
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    await waitFor(() => expect(actions.submitQuiz).toHaveBeenCalledWith(LESSON, { picks: {}, texts: { [TEXT_Q]: "x" }, files: {} }));
  });

  it("refuses a file that is the wrong kind or too big before uploading anything", async () => {
    const user = userEvent.setup({ applyAccept: false });
    show();
    await user.upload(screen.getByLabelText("File for question 2"), new File(["x"], "run.exe"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/document or a picture/);
    await user.upload(screen.getByLabelText("File for question 2"), pdf("big.pdf", 10 * 1024 * 1024 + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Files can be up to 10 MB.");
    expect(actions.prepareQuizFileUpload).not.toHaveBeenCalled();
  });

  it("says so when the upload can't start or doesn't finish", async () => {
    const user = userEvent.setup();
    show();
    actions.prepareQuizFileUpload.mockResolvedValueOnce({ error: "That question doesn't take a file." });
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    expect(await screen.findByRole("alert")).toHaveTextContent("That question doesn't take a file.");
    upload.uploadWithProgress.mockResolvedValueOnce({ ok: false, reason: "network" });
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The upload didn't finish. Try again."));
    expect(screen.queryByRole("button", { name: "Remove file" })).not.toBeInTheDocument();
  });

  it("won't upload to a path or token that isn't the shape the server makes", async () => {
    const user = userEvent.setup();
    show();
    actions.prepareQuizFileUpload.mockResolvedValueOnce({ path: "../../elsewhere", token: "tokentokentoken" });
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start the upload. Try again.");
    expect(upload.uploadWithProgress).not.toHaveBeenCalled();
  });

  it("holds the submit button while a file is still uploading", async () => {
    const user = userEvent.setup();
    let finish: (v: { ok: true }) => void = () => undefined;
    upload.uploadWithProgress.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    show();
    await user.upload(screen.getByLabelText("File for question 2"), pdf());
    expect(await screen.findByRole("button", { name: "Uploading…" })).toBeDisabled();
    finish({ ok: true });
    expect(await screen.findByRole("button", { name: "Submit answers" })).toBeEnabled();
  });

  it("lists the words and files of earlier attempts, with a link to each file through the route that checks who is asking", () => {
    const attempt: MemberAttempt = {
      id: "qatt_AAAAAAAAAAA1",
      submittedAt: "2027-01-04T15:00:00.000Z",
      scorePercent: 0,
      correctCount: 0,
      questionCount: 0,
      passed: true,
      importedFrom: "kajabi",
      openAnswers: [{ questionId: TEXT_Q, prompt: "What stood out, as it was asked then?", text: "Earlier words", fileName: null }, { questionId: FILE_Q, prompt: null, text: null, fileName: "old.pdf" }],
    };
    show({ attempts: [attempt] });
    expect(screen.getByText(/Jan 4, 2027, 10:00 AM: submitted/)).toHaveTextContent("(from Kajabi)");
    expect(screen.getByText("What stood out, as it was asked then?")).toBeInTheDocument();
    // A snapshot that wasn't recorded falls back to the question as it is now.
    expect(screen.getByRole("link", { name: "old.pdf" }).closest("li")).toHaveTextContent("Upload your letter");
    expect(screen.getByText("Earlier words")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "old.pdf" })).toHaveAttribute("href", `/api/course-quiz-answers/qatt_AAAAAAAAAAA1/${FILE_Q}`);
  });

  it("disables the fields when the page is read only", () => {
    show({ readOnlyReason: "Viewing as a member" });
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    expect(screen.getByLabelText("File for question 2")).toBeDisabled();
  });

  it("starts over on retaking", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "x");
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    await user.click(await screen.findByRole("button", { name: "Take the quiz again" }));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("");
  });
});

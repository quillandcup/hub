/**
 * Importing answers that name their question only by title and position (what Kajabi's submission view sends): joined to the Hub's
 * question by position with the title as a check, and kept with their own wording, unlinked, when the quiz was edited since. Invented data.
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { answersToJson, type StoredAnswer } from "@/lib/kajabi/quiz-responses";
import { importKajabiQuizResponses, questionOfAnswer } from "@/lib/courses/quiz-response-import";
import { loadMemberQuiz } from "@/lib/courses/quiz-member";
import { loadAttemptView } from "@/lib/courses/admin-quiz";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";

const posAnswer = (position: number, over: Partial<StoredAnswer>): StoredAnswer => ({ questionKey: `pos:${position}`, prompt: null, text: null, optionKeys: [], optionLabels: [], file: null, position, questionType: null, ...over });

async function build(answers: StoredAnswer[]) {
  const data = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "academy", title: "Academy", source: "kajabi", source_key: "course-k" })],
    courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Reflection", source: "kajabi", source_key: "kl-1" })],
    members: [{ id: ADA, name: "Ada Example", email: "ada@example.test" }],
    courseAccess: [{ member_id: ADA, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: null, origin: "purchase" } as never],
    kajabiQuizResponses: [{ quiz_kajabi_id: "489121", submission_key: "5001", course_kajabi_id: "course-k", email: "ada@example.test", submitted_at: "2026-05-10T22:38:00.000Z", answers: answersToJson(answers) as never, content_hash: "h", captured_at: "2027-01-01T00:00:00.000Z", deleted_at: null }],
  });
  const repos = createInMemoryRepos(data);
  await repos.quizzes.syncImportedQuiz(LESSON, {
    sourceKey: "489121",
    passingPercent: null,
    hideAnswers: false,
    questions: [
      { sourceKey: "e-1", prompt: "What stood out?", kind: "short_answer", allowsMultiple: false, options: [] },
      { sourceKey: "e-2", prompt: "How did it feel?", kind: "choice", graded: false, allowsMultiple: false, options: [{ sourceKey: "o-easy", label: "Easy", isCorrect: false }, { sourceKey: "o-hard", label: "Hard", isCorrect: false }] },
      { sourceKey: "e-3", prompt: "Upload your letter", kind: "file_upload", allowsMultiple: false, options: [] },
    ],
  });
  return { data, repos };
}

const deps = () => {
  const copies: [string, string][] = [];
  return { copies, copyFile: vi.fn(async (from: string, to: string) => (copies.push([from, to]), true)), randomId: () => "00000000-0000-4000-8000-000000000001" };
};

const matching = [
  posAnswer(1, { prompt: "What stood out?", text: "The ending.", questionType: "short_answer" }),
  posAnswer(2, { prompt: "How did it feel?", optionLabels: ["Hard"], questionType: "multiple_choice" }),
  posAnswer(3, { prompt: "Upload your letter", questionType: "file_upload", file: { name: "letter.pdf", bytes: 2048, sourceUrl: "https://x.test/f", storagePath: "kajabi-import/489121/5001/letter.pdf", copyFailure: null } }),
];

describe("answers keyed by position", () => {
  it("are joined to the Hub's question at that position when the title agrees, wording kept, nothing left over", async () => {
    const { repos } = await build(matching);
    const d = deps();
    const { courses } = await importKajabiQuizResponses(repos, d);
    expect(courses[0].answers).toEqual({ imported: 3, unlinked: 0, questionGone: 0, unreadable: 0 });
    const quiz = (await repos.quizzes.quizOfLesson(LESSON))!;
    const [attempt] = await repos.quizzes.attemptsOf(ADA, quiz.id);
    expect(attempt.unlinkedAnswers).toEqual([]);
    const questions = await repos.quizzes.questionsOf(quiz.id);
    const byQ = Object.fromEntries((await repos.quizzes.answersOf(attempt.id)).map((a) => [questions.find((q) => q.id === a.questionId)!.sourceKey, a]));
    expect(byQ["e-1"]).toMatchObject({ answerText: "The ending.", promptSnapshot: "What stood out?" });
    expect(byQ["e-2"].selectedOptionIds).toEqual([questions[1].options.find((o) => o.sourceKey === "o-hard")!.id]);
    expect(byQ["e-3"].file?.name).toBe("letter.pdf");
    expect(d.copies).toHaveLength(1);
  });
});

describe("answers whose question was edited since", () => {
  const edited = [
    posAnswer(1, { prompt: "What stood out? (the old wording)", text: "The ending.", questionType: "short_answer" }),
    posAnswer(2, { prompt: "How did it feel?", optionLabels: ["Hard"], questionType: "multiple_choice" }),
    posAnswer(3, { prompt: "A question that is gone", questionType: "file_upload", file: { name: "old.pdf", bytes: 10, sourceUrl: "https://x.test/o", storagePath: "kajabi-import/489121/5001/old.pdf", copyFailure: null } }),
  ];

  it("are kept on the attempt with their own wording and position, not attached to a question they may not belong to, and counted", async () => {
    const { repos } = await build(edited);
    const d = deps();
    const { courses } = await importKajabiQuizResponses(repos, d);
    expect(courses[0].answers).toEqual({ imported: 1, unlinked: 2, questionGone: 0, unreadable: 0 });
    expect(courses[0].files).toEqual({ copied: 1, notCopied: 0 });
    const quiz = (await repos.quizzes.quizOfLesson(LESSON))!;
    const [attempt] = await repos.quizzes.attemptsOf(ADA, quiz.id);
    expect(attempt.unlinkedAnswers).toEqual([
      { position: 1, prompt: "What stood out? (the old wording)", kind: "short_answer", text: "The ending.", labels: [], file: null },
      { position: 3, prompt: "A question that is gone", kind: "file_upload", text: null, labels: [], file: { path: `${ADA}/00000000-0000-4000-8000-000000000001/old.pdf`, name: "old.pdf", bytes: 10 } },
    ]);
    // Only the answer whose title agrees is attached to a question.
    expect((await repos.quizzes.answersOf(attempt.id)).map((a) => a.promptSnapshot)).toEqual(["How did it feel?"]);
  });

  it("are shown to staff and to the member under their own wording, with the file reachable by its place", async () => {
    const { repos } = await build(edited);
    await importKajabiQuizResponses(repos, deps());
    const quiz = (await repos.quizzes.quizOfLesson(LESSON))!;
    const [attempt] = await repos.quizzes.attemptsOf(ADA, quiz.id);

    const staff = (await loadAttemptView(repos, quiz.id, attempt.id))!;
    expect(staff.unlinked.map((u) => [u.position, u.prompt, u.text, u.file])).toEqual([
      [1, "What stood out? (the old wording)", "The ending.", null],
      [3, "A question that is gone", null, { name: "old.pdf", bytes: 10 }],
    ]);
    expect(JSON.stringify(staff)).not.toContain(`${ADA}/0000`);

    const member = (await loadMemberQuiz(repos, LESSON, ADA))!;
    expect(member.attempts[0].openAnswers).toEqual(
      expect.arrayContaining([
        { questionId: "pos_1", prompt: "What stood out? (the old wording)", text: "The ending.", fileName: null },
        { questionId: "pos_3", prompt: "A question that is gone", text: null, fileName: "old.pdf" },
      ]),
    );
  });

  it("run again add nothing, and an unlinked answer with nothing to keep (no place, nothing said) is counted as gone", async () => {
    const { repos, data } = await build([...edited, { questionKey: "old-id", prompt: null, text: "x", optionKeys: [], optionLabels: [], file: null }, posAnswer(9, {})]);
    const first = (await importKajabiQuizResponses(repos, deps())).courses[0];
    const second = (await importKajabiQuizResponses(repos, deps())).courses[0];
    expect(first.answers).toMatchObject({ unlinked: 2, questionGone: 2 });
    expect(second.submissions).toMatchObject({ imported: 0, alreadyImported: 1 });
    expect(data.quizAttempts).toHaveLength(1);
  });
});

describe("questionOfAnswer", () => {
  const q = (position: number, prompt: string, kind: "choice" | "short_answer" | "file_upload", sourceKey: string | null = null) => ({ id: `qques_${position}`, quizId: "quiz", position, prompt, kind, graded: false, allowsMultiple: false, sourceKey, options: [] });
  const questions = [q(1, "What stood out?", "short_answer", "e-1"), q(2, "How did it feel?", "choice", "e-2"), q(3, "Upload", "file_upload", "e-3")];

  it("prefers the editor's id, then position with the title as a check, ignoring case and spacing", () => {
    expect(questionOfAnswer(questions, posAnswer(9, { questionKey: "e-2" }))?.id).toBe("qques_2");
    expect(questionOfAnswer(questions, posAnswer(2, { prompt: "  how DID it   feel? " }))?.id).toBe("qques_2");
  });

  it("is null, never a guess, for a missing title, another title, a position out of range, or a kind that disagrees", () => {
    expect(questionOfAnswer(questions, posAnswer(2, { prompt: null }))).toBeNull();
    expect(questionOfAnswer(questions, posAnswer(2, { prompt: "What stood out?" }))).toBeNull();
    expect(questionOfAnswer(questions, posAnswer(7, { prompt: "How did it feel?" }))).toBeNull();
    expect(questionOfAnswer(questions, posAnswer(0, { prompt: "How did it feel?" }))).toBeNull();
    expect(questionOfAnswer(questions, posAnswer(2, { prompt: "How did it feel?", questionType: "file_upload" }))).toBeNull();
    expect(questionOfAnswer(questions, { ...posAnswer(2, { prompt: "How did it feel?" }), position: null })).toBeNull();
  });
});

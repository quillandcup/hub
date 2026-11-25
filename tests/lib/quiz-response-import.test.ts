/** Bronze quiz responses -> Hub attempts. Every person, email and answer here is invented. */
import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { answersToJson, type StoredAnswer } from "@/lib/kajabi/quiz-responses";
import { QuizResponseImportError, importKajabiQuizResponses, mapAnswer, type ResponseImportDeps } from "@/lib/courses/quiz-response-import";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const COURSE_K = "course-kajabi-1";
const LESSON = "les_AAAAAAAAAAA1";
const GRADED_LESSON = "les_AAAAAAAAAAA2";

// Four members: current (with access), lapsed (no access), merged (the kept member has the other address as an alias), and twins who share an address.
const CURRENT = "mbr_AAAAAAAAAAA1";
const LAPSED = "mbr_AAAAAAAAAAA2";
const MERGED = "mbr_AAAAAAAAAAA3";
const TWIN_A = "mbr_AAAAAAAAAAA4";
const TWIN_B = "mbr_AAAAAAAAAAA5";

const answerOf = (over: Partial<StoredAnswer>): StoredAnswer => ({ questionKey: "q-text", prompt: "What stood out? (as it was asked)", text: "Words.", optionKeys: [], optionLabels: [], file: null, ...over });
const bronzeRow = (email: string, over: Record<string, unknown> = {}) => ({
  quiz_kajabi_id: "489121",
  submission_key: `s-${email}`,
  course_kajabi_id: COURSE_K,
  email,
  submitted_at: "2026-03-04T15:30:00.000Z",
  answers: answersToJson([answerOf({}), answerOf({ questionKey: "q-choice", prompt: "How was it?", text: null, optionKeys: ["o-hard"] })]) as never,
  content_hash: "h",
  captured_at: "2027-01-01T00:00:00.000Z",
  deleted_at: null,
  ...over,
});

async function build(extra: { rows?: ReturnType<typeof bronzeRow>[]; graded?: boolean; members?: boolean } = {}) {
  const data = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "academy", title: "Academy", source: "kajabi", source_key: COURSE_K })],
    courseLessons: [
      lessonRow({ id: LESSON, course_id: COURSE, title: "Reflection", source: "kajabi", source_key: "kl-1" }),
      lessonRow({ id: GRADED_LESSON, course_id: COURSE, title: "Scored", position: 2, source: "kajabi", source_key: "kl-2" }),
    ],
    members: [
      { id: CURRENT, name: "Current Member", email: "current@example.test" },
      { id: LAPSED, name: "Lapsed Member", email: "lapsed@example.test", status: "cancelled" },
      { id: MERGED, name: "Merged Member", email: "merged-new@example.test" },
      { id: TWIN_A, name: "Twin A", email: "twins@example.test" },
      { id: TWIN_B, name: "Twin B", email: "twins@example.test" },
    ],
    emailAliases: [{ id: "ealias_AAAAAAAAAAA1", alias_email: "merged-old@example.test", canonical_email: "merged-new@example.test", memberId: MERGED, active: true } as never],
    courseAccess: [
      { member_id: CURRENT, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: null, origin: "purchase" } as never,
      // Access that ended: a lapsed member is still a member.
      { member_id: LAPSED, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: "2026-01-01T00:00:00.000Z", origin: "purchase" } as never,
      { member_id: MERGED, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: null, origin: "purchase" } as never,
    ],
    kajabiQuizResponses: extra.rows ?? [],
  });
  const repos = createInMemoryRepos(data);
  // The imported reflection quiz (nothing graded) and the imported scored quiz.
  const reflection = await repos.quizzes.syncImportedQuiz(LESSON, {
    sourceKey: "489121",
    passingPercent: null,
    hideAnswers: false,
    questions: [
      { sourceKey: "q-text", prompt: "What stood out? (as it is asked now)", kind: "short_answer", allowsMultiple: false, options: [] },
      { sourceKey: "q-file", prompt: "Upload", kind: "file_upload", allowsMultiple: false, options: [] },
      { sourceKey: "q-choice", prompt: "How was it?", kind: "choice", graded: false, allowsMultiple: false, options: [{ sourceKey: "o-easy", label: "Easy", isCorrect: false }, { sourceKey: "o-hard", label: "Hard", isCorrect: false }] },
    ],
  });
  expect(reflection.status).toBe("synced");
  if (extra.graded) {
    await repos.quizzes.syncImportedQuiz(GRADED_LESSON, {
      sourceKey: "1573355",
      passingPercent: 70,
      hideAnswers: false,
      questions: [{ sourceKey: "g1", prompt: "Two plus two?", allowsMultiple: false, options: [{ sourceKey: "g1a", label: "4", isCorrect: true }, { sourceKey: "g1b", label: "5", isCorrect: false }] }],
    });
  }
  return { data, repos };
}

const deps = (): ResponseImportDeps & { copies: [string, string][] } => {
  const copies: [string, string][] = [];
  let n = 0;
  return {
    copies,
    copyFile: vi.fn(async (from: string, to: string) => {
      copies.push([from, to]);
      return true;
    }),
    randomId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
};
const run = (built: Awaited<ReturnType<typeof build>>, d = deps(), options: Parameters<typeof importKajabiQuizResponses>[2] = {}) => importKajabiQuizResponses(built.repos, d, options);
const quizOf = async (b: Awaited<ReturnType<typeof build>>, lesson = LESSON) => (await b.repos.quizzes.quizOfLesson(lesson))!;

describe("a current member's past response", () => {
  it("becomes an attempt marked from Kajabi, never scored, with the question as it was worded then, and does not complete the lesson", async () => {
    const built = await build({ rows: [bronzeRow("current@example.test")] });
    const { courses } = await run(built);

    expect(courses[0]).toMatchObject({ submissionsInBronze: 1, responders: { matched: 1 }, submissions: { imported: 1, keptNoMember: 0 }, answers: { imported: 2 } });
    expect(courses[0]).not.toHaveProperty("completions");
    const quiz = await quizOf(built);
    const [attempt] = await built.repos.quizzes.attemptsOf(CURRENT, quiz.id);
    expect(attempt).toMatchObject({ importedFrom: "kajabi", questionCount: 0, correctCount: 0, scorePercent: 0, passed: true, submittedAt: "2026-03-04T15:30:00.000Z" });
    const questions = await built.repos.quizzes.questionsOf(quiz.id);
    const answers = await built.repos.quizzes.answersOf(attempt.id);
    const byQuestion = Object.fromEntries(answers.map((a) => [questions.find((q) => q.id === a.questionId)!.sourceKey, a]));
    expect(byQuestion["q-text"]).toMatchObject({ answerText: "Words.", promptSnapshot: "What stood out? (as it was asked)", isCorrect: null });
    expect(byQuestion["q-choice"].selectedOptionIds).toEqual([questions.find((q) => q.sourceKey === "q-choice")!.options.find((o) => o.sourceKey === "o-hard")!.id]);
    // Completion comes from the Kajabi progress import, never from this one.
    expect(built.data.lessonProgress).toHaveLength(0);
    expect(await built.repos.courseProgress.completedLessonIds(CURRENT, [LESSON])).toEqual(new Set());
  });

  it("sends nobody anything and writes no activity", async () => {
    const built = await build({ rows: [bronzeRow("current@example.test")] });
    await run(built);
    expect(built.data.activities).toHaveLength(0);
    expect(built.data.notificationLog).toHaveLength(0);
    expect(built.data.inAppNotifications).toHaveLength(0);
  });
});

describe("a lapsed member (no course access)", () => {
  it("keeps their response in the Hub for staff, with no new access", async () => {
    const built = await build({ rows: [bronzeRow("lapsed@example.test")] });
    const { courses } = await run(built);

    expect(courses[0]).toMatchObject({ responders: { matched: 1, keptNoMember: 0 }, submissions: { imported: 1 } });
    const quiz = await quizOf(built);
    expect(await built.repos.quizzes.attemptsOf(LAPSED, quiz.id)).toHaveLength(1);
    // The import records what happened in Kajabi; it opens nothing for them.
    expect(await built.repos.courseProgress.completedLessonIds(LAPSED, [LESSON])).toEqual(new Set());
    expect(built.data.courseAccess.filter((a) => a.member_id === LAPSED)).toHaveLength(1);
  });
});

describe("a merged member or a second address", () => {
  it("matches an address that is an alias of the member who was kept, and the kept member's own", async () => {
    const built = await build({ rows: [bronzeRow("merged-old@example.test"), bronzeRow("Merged-New@Example.test", { submission_key: "s-2" })] });
    const { courses } = await run(built);
    expect(courses[0]).toMatchObject({ responders: { matched: 2 }, submissions: { imported: 2 } });
    const quiz = await quizOf(built);
    expect((await built.repos.quizzes.attemptsOf(MERGED, quiz.id)).map((a) => a.importedFrom)).toEqual(["kajabi", "kajabi"]);
  });

  it("does not use an inactive alias, and never guesses between two members who share an address", async () => {
    const built = await build({ rows: [bronzeRow("merged-old@example.test"), bronzeRow("twins@example.test", { submission_key: "s-twin" })] });
    built.data.emailAliases[0].active = false;
    const { courses } = await run(built);
    expect(courses[0]).toMatchObject({ responders: { matched: 0, keptNoMember: 1, ambiguous: 1 }, submissions: { imported: 0, keptNoMember: 1, ambiguous: 1 } });
    expect(built.data.quizAttempts).toHaveLength(0);
    // Both stay in Bronze.
    expect(built.data.kajabiQuizResponses).toHaveLength(2);
  });
});

describe("a responder who is not a member", () => {
  it("is kept in Bronze and counted, imports nothing, creates no member, and is picked up by a later run once a member has that email", async () => {
    const built = await build({ rows: [bronzeRow("stranger@example.test")] });
    const membersBefore = built.data.members.length;
    const first = (await run(built)).courses[0];
    expect(first).toMatchObject({ submissionsInBronze: 1, responders: { keptNoMember: 1 }, submissions: { imported: 0, keptNoMember: 1 } });
    expect(built.data.quizAttempts).toHaveLength(0);
    expect(built.data.members).toHaveLength(membersBefore);
    expect(built.data.kajabiQuizResponses).toHaveLength(1);

    // The member appears (a late sign-up, or an address added as an alias).
    built.data.members.push({ id: "mbr_AAAAAAAAAAA9", name: "Late Member", email: "stranger@example.test", status: "active" } as never);
    const second = (await run(built)).courses[0];
    expect(second).toMatchObject({ responders: { matched: 1, keptNoMember: 0 }, submissions: { imported: 1, keptNoMember: 0 } });
    const quiz = await quizOf(built);
    expect(await built.repos.quizzes.attemptsOf("mbr_AAAAAAAAAAA9", quiz.id)).toHaveLength(1);
  });
});

describe("insert only, and repeatable", () => {
  it("inserts nothing the second time and never touches an attempt the member made in the Hub", async () => {
    const built = await build({ rows: [bronzeRow("current@example.test")] });
    const quiz = await quizOf(built);
    const mine = await built.repos.quizzes.recordAttempt({ quizId: quiz.id, memberId: CURRENT, questionCount: 0, correctCount: 0, scorePercent: 0, passed: true, submittedAt: "2027-01-01T00:00:00.000Z", answers: [] });

    const first = (await run(built)).courses[0];
    const second = (await run(built)).courses[0];

    expect(first.submissions.imported).toBe(1);
    expect(second.submissions).toMatchObject({ imported: 0, alreadyImported: 1 });
    expect(await built.repos.quizzes.attemptsOf(CURRENT, quiz.id)).toHaveLength(2);
    expect(await built.repos.quizzes.attemptById(mine.id)).toMatchObject({ importedFrom: null, submittedAt: "2027-01-01T00:00:00.000Z" });
    expect(built.data.quizAttemptAnswers.filter((a) => a.attempt_id === mine.id)).toHaveLength(0);
  });

  it("leaves a lesson's existing progress as it is, and writes nothing in a dry run", async () => {
    const built = await build({ rows: [bronzeRow("current@example.test")] });
    await built.repos.courseProgress.insertProgressIfAbsent([{ member_id: CURRENT, lesson_id: LESSON, completed_at: "2025-05-05T00:00:00.000Z", last_position_seconds: 0 }]);
    const dry = (await run(built, deps(), { dryRun: true })).courses[0];
    expect(dry).toMatchObject({ submissions: { imported: 1 } });
    expect(built.data.quizAttempts).toHaveLength(0);
    await run(built);
    expect(built.data.lessonProgress).toHaveLength(1);
    expect((await built.repos.courseProgress.progressOfLessons([LESSON]))[0].completed_at).toBe("2025-05-05T00:00:00.000Z");
  });

  it("writes no completion for a quiz with a scored question either", async () => {
    const rows = [bronzeRow("current@example.test", { quiz_kajabi_id: "1573355", submission_key: "g-1", answers: answersToJson([answerOf({ questionKey: "g1", prompt: "Two plus two?", text: null, optionKeys: ["g1a"] })]) })];
    const built = await build({ rows, graded: true });
    const { courses } = await run(built);
    expect(courses[0]).toMatchObject({ submissions: { imported: 1 } });
    expect(built.data.lessonProgress).toHaveLength(0);
    const [attempt] = await built.repos.quizzes.attemptsOf(CURRENT, (await quizOf(built, GRADED_LESSON)).id);
    expect(attempt).toMatchObject({ questionCount: 0, importedFrom: "kajabi" });
  });
});

describe("files and answers that don't map", () => {
  const fileRow = (storagePath: string | null) =>
    bronzeRow("current@example.test", { answers: answersToJson([answerOf({ questionKey: "q-file", prompt: "Upload", text: null, file: { name: "letter.pdf", bytes: 2048, sourceUrl: "https://x.test/f", storagePath, copyFailure: storagePath ? null : "expired" } })]) });

  it("copies a file into the member's own folder, keeps the Bronze copy, and says what could not be copied", async () => {
    const built = await build({ rows: [fileRow("kajabi-import/489121/s/letter.pdf")] });
    const d = deps();
    const { courses } = await run(built, d);
    expect(courses[0].files).toEqual({ copied: 1, notCopied: 0 });
    expect(d.copies).toEqual([["kajabi-import/489121/s/letter.pdf", `${CURRENT}/00000000-0000-4000-8000-000000000001/letter.pdf`]]);
    const [attempt] = await built.repos.quizzes.attemptsOf(CURRENT, (await quizOf(built)).id);
    expect((await built.repos.quizzes.answersOf(attempt.id))[0].file).toEqual({ path: `${CURRENT}/00000000-0000-4000-8000-000000000001/letter.pdf`, name: "letter.pdf", bytes: 2048 });

    const lost = await build({ rows: [fileRow(null)] });
    expect((await run(lost)).courses[0]).toMatchObject({ files: { copied: 0, notCopied: 1 }, submissions: { imported: 1 } });
    const refused = await build({ rows: [fileRow("kajabi-import/489121/s/letter.pdf")] });
    const bad = { ...deps(), copyFile: vi.fn(async () => false) };
    expect((await run(refused, bad)).courses[0].files).toEqual({ copied: 0, notCopied: 1 });
  });

  it("copies nothing in a dry run, and counts a file for a quiz that isn't in the Hub as a quiz not found", async () => {
    const built = await build({ rows: [fileRow("kajabi-import/489121/s/letter.pdf"), bronzeRow("current@example.test", { quiz_kajabi_id: "no-such-quiz", submission_key: "x" })] });
    const d = deps();
    const dry = (await run(built, d, { dryRun: true })).courses[0];
    expect(d.copyFile).not.toHaveBeenCalled();
    expect(dry).toMatchObject({ files: { copied: 1 }, submissions: { imported: 1, noQuiz: 1 } });
  });

  it("counts answers to questions Kajabi dropped, and answers it can't read", async () => {
    const rows = [bronzeRow("current@example.test", { answers: answersToJson([answerOf({ questionKey: "gone" }), answerOf({ questionKey: "q-choice", text: null, optionKeys: ["unknown"], optionLabels: ["Nothing like it"] }), answerOf({ questionKey: "q-text" })]) })];
    const built = await build({ rows });
    const { courses } = await run(built);
    expect(courses[0].answers).toEqual({ imported: 1, questionGone: 1, unreadable: 1 });
  });
});

describe("mapAnswer", () => {
  const choice = { id: "qques_a", quizId: "q", position: 1, prompt: "p", kind: "choice" as const, graded: false, allowsMultiple: true, sourceKey: "k", options: [{ id: "qopt_1", position: 1, label: "Easy", isCorrect: false, sourceKey: "o1" }, { id: "qopt_2", position: 2, label: "Hard  Going", isCorrect: false, sourceKey: "o2" }] };

  it("maps picked answers by key, falls back to their wording, and keeps the question's order", () => {
    expect(mapAnswer(choice, answerOf({ text: null, optionKeys: ["o2", "o1"] }))).toMatchObject({ ok: true, selectedOptionIds: ["qopt_1", "qopt_2"] });
    expect(mapAnswer(choice, answerOf({ text: null, optionKeys: ["zzz"], optionLabels: ["hard going"] }))).toMatchObject({ ok: true, selectedOptionIds: ["qopt_2"] });
    expect(mapAnswer(choice, answerOf({ text: null }))).toEqual({ ok: false });
  });

  it("reads a short answer's text and a file question's file, and nothing from the wrong kind of answer", () => {
    expect(mapAnswer({ ...choice, kind: "short_answer", options: [] }, answerOf({ text: "  hello " }))).toMatchObject({ ok: true, answerText: "hello" });
    expect(mapAnswer({ ...choice, kind: "short_answer", options: [] }, answerOf({ text: null, optionKeys: ["o1"] }))).toEqual({ ok: false });
    expect(mapAnswer({ ...choice, kind: "file_upload", options: [] }, answerOf({ text: "words only" }))).toEqual({ ok: false });
  });
});

describe("which courses", () => {
  it("does one course by its slug, says so for one that isn't there, and does nothing for a course with no Bronze responses", async () => {
    const built = await build();
    expect((await run(built, deps(), { courseSlug: "academy" })).courses[0]).toMatchObject({ slug: "academy", submissionsInBronze: 0 });
    await expect(run(built, deps(), { courseSlug: "nope" })).rejects.toBeInstanceOf(QuizResponseImportError);
  });
});

/** Reading, saving and copying members' past quiz responses (the capture side). Every fixture is invented; none holds a real person. */
import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryKajabiCourseRepository } from "@/lib/data/kajabi-courses";
import { checkQuizFile } from "@/lib/courses/quiz-files";
import { answerText, answersFromJson, answersToJson, copyResponseFiles, parseSubmission, responseContentHash, submissionsListedIn, type FileCopyIO, type StoredAnswer } from "@/lib/kajabi/quiz-responses";

const ADA = "ada.example@example.test";

/** A grading view as plain nested JSON: the responder, the date, and each question with the answer. */
const plainView = (over: Record<string, unknown> = {}) => ({
  id: 9001,
  email: "Ada.Example@Example.test",
  name: "Ada Example",
  submitted_at: "2026-03-04T15:30:00.000Z",
  answers: [
    { question_id: 11, question_text: "<p>What stood out?</p>", answer_text: "<p>The ending.</p><p>And the start.</p>" },
    { question_id: 12, question_text: "How did it feel?", selected_answers: [{ id: 201, text: "Hard" }] },
    { question_id: 13, question_text: "Upload your letter", file: { url: "https://files.example.test/letter.pdf?sig=abc", name: "letter.pdf", size: 2048 } },
    { question_id: 14, question_text: "Left blank", answer_text: "" },
  ],
  ...over,
});

/** The same, as a JSON:API document with the answers in `included`. */
const jsonApiView = () => ({
  data: { id: "9002", type: "quiz_submissions", attributes: { email: ADA, created_at: "2026-03-05T10:00:00Z" }, relationships: { quiz_responses: { data: [{ type: "quiz_responses", id: "r1" }, { type: "quiz_responses", id: "r2" }] } } },
  included: [
    { id: "r1", type: "quiz_responses", attributes: { question_id: 11, question: "What stood out?", response: "Plain words" } },
    { id: "r2", type: "quiz_responses", attributes: { question_id: 12, question: "How did it feel?", quiz_answer_ids: [201, 202] } },
  ],
});

describe("parseSubmission", () => {
  it("reads the responder (lower case, no name), the date and every answer of plain JSON, keeping line breaks and dropping blanks", () => {
    const parsed = parseSubmission([plainView()], null)!;
    expect(parsed).toMatchObject({ submissionKey: "9001", email: ADA, submittedAt: "2026-03-04T15:30:00.000Z" });
    expect(parsed.answers.map((a) => a.questionKey)).toEqual(["11", "12", "13"]);
    expect(parsed.answers[0]).toMatchObject({ prompt: "What stood out?", text: "The ending.\nAnd the start.", optionKeys: [], file: null });
    expect(parsed.answers[1]).toMatchObject({ optionKeys: ["201"], optionLabels: ["Hard"], text: null });
    expect(parsed.answers[2].file).toEqual({ name: "letter.pdf", bytes: 2048, sourceUrl: "https://files.example.test/letter.pdf?sig=abc" });
    // The name is never part of what is kept.
    expect(JSON.stringify(parsed)).not.toContain("Ada Example");
  });

  it("reads a JSON:API document with the answers in included", () => {
    const parsed = parseSubmission([jsonApiView()], null)!;
    expect(parsed).toMatchObject({ submissionKey: "9002", email: ADA, submittedAt: "2026-03-05T10:00:00.000Z" });
    expect(parsed.answers.map((a) => [a.questionKey, a.text, a.optionKeys])).toEqual([["11", "Plain words", []], ["12", null, ["201", "202"]]]);
  });

  it("prefers the key the capture knows the submission by, and reads a question named by a nested object", () => {
    const parsed = parseSubmission([{ responder: { email: ADA }, items: [{ question: { id: 7, text: "Why?" }, value: "Because." }] }], "from-the-address")!;
    expect(parsed.submissionKey).toBe("from-the-address");
    expect(parsed.answers[0]).toMatchObject({ questionKey: "7", prompt: "Why?", text: "Because." });
  });

  it("is null without an email, without a key or without an answer", () => {
    expect(parseSubmission([plainView({ email: undefined })], null)).toBeNull();
    expect(parseSubmission([{ email: ADA, answers: [] }], "k")).toBeNull();
    expect(parseSubmission([{ email: ADA, answers: [{ question_id: 1, answer_text: "x" }] }], null)).toBeNull();
    expect(parseSubmission([], "k")).toBeNull();
  });

  it("takes the fuller of two readings of the same question, and ignores a question's own wording as its answer", () => {
    const parsed = parseSubmission([{ email: ADA, id: 5, answers: [{ question_id: 1, question: "Say more", text: "Say more" }, { question_id: 1, question: "Say more", answer_text: "Here is more." }] }], null)!;
    expect(parsed.answers).toHaveLength(1);
    expect(parsed.answers[0].text).toBe("Here is more.");
  });
});

describe("submissionsListedIn", () => {
  it("lists the rows that carry a responder, by key, without the questions and answers inside them", () => {
    const list = { data: [{ id: 1, email: "A@example.test", submitted_at: "2026-01-02T03:04:05Z", score: "N/A" }, { id: 2, email: "b@example.test" }, { id: 3 }], questions: [{ id: 99, text: "Q" }] };
    expect(submissionsListedIn([list])).toEqual([
      { submissionKey: "1", email: "a@example.test", submittedAt: "2026-01-02T03:04:05.000Z" },
      { submissionKey: "2", email: "b@example.test", submittedAt: null },
    ]);
    expect(submissionsListedIn([{ nothing: true }])).toEqual([]);
  });
});

describe("answerText", () => {
  it("turns markup into text with the writer's paragraphs, and is null for nothing", () => {
    expect(answerText("<p>One &amp; two</p><p>Three<br>four</p>")).toBe("One & two\nThree\nfour");
    expect(answerText("  \n ")).toBeNull();
    expect(answerText(5)).toBeNull();
    expect(answerText("<scr<script>ipt>x</scr</script>ipt>")).not.toMatch(/<script/i);
  });
});

describe("what Bronze keeps", () => {
  const answers = (): StoredAnswer[] => [
    { questionKey: "11", prompt: "P", text: "T", optionKeys: ["b", "a"], optionLabels: [], file: null },
    { questionKey: "13", prompt: null, text: null, optionKeys: [], optionLabels: [], file: { name: "l.pdf", bytes: 5, sourceUrl: "https://x.test/l", storagePath: null, copyFailure: null } },
  ];

  it("round-trips through the JSON in the column, and reads a malformed one as what it can", () => {
    expect(answersFromJson(answersToJson(answers()))).toEqual(answers());
    expect(answersFromJson("nope")).toEqual([]);
    expect(answersFromJson([{ no: "key" }, { question_key: "1", option_keys: "x", file: { name: 4 } }])).toEqual([
      { questionKey: "1", prompt: null, text: null, optionKeys: [], optionLabels: [], file: { name: "file", bytes: null, sourceUrl: null, storagePath: null, copyFailure: null } },
    ]);
  });

  it("hashes the content, not the order, and not where a file's copy is", () => {
    const row = { email: ADA, submittedAt: null, answers: answers() };
    const reordered = { ...row, answers: [...answers()].reverse().map((a) => ({ ...a, optionKeys: [...a.optionKeys].reverse() })) };
    const copied = { ...row, answers: answers().map((a) => (a.file ? { ...a, file: { ...a.file, storagePath: "kajabi-import/x", copyFailure: null } } : a)) };
    expect(responseContentHash(reordered)).toBe(responseContentHash(row));
    expect(responseContentHash(copied)).toBe(responseContentHash(row));
    expect(responseContentHash({ ...row, email: "other@example.test" })).not.toBe(responseContentHash(row));
  });
});

describe("saving to Bronze", () => {
  const NOW = new Date("2027-02-03T15:00:00.000Z");
  const row = (over: Record<string, unknown> = {}) => ({
    quizKajabiId: "489121",
    submissionKey: "9001",
    courseKajabiId: "course-1",
    email: ADA,
    submittedAt: "2026-03-04T15:30:00.000Z",
    answers: [{ questionKey: "11", prompt: "P", text: "words", optionKeys: [], optionLabels: [], file: null }] as StoredAnswer[],
    ...over,
  });

  it("writes a new submission, nothing for the same one, an update for a changed one, and nothing in a dry run", async () => {
    const data = new InMemoryDataset();
    const twin = new InMemoryKajabiCourseRepository(data);
    vi.resetModules();
    vi.doMock("@/lib/data/kajabi-courses", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/kajabi-courses")>()), SupabaseKajabiCourseRepository: class { constructor() { return twin; } } }));
    const mod = await import("@/lib/kajabi/quiz-responses");

    expect(await mod.saveQuizResponse({} as never, row(), NOW, { dryRun: true })).toBe("created");
    expect(data.kajabiQuizResponses).toHaveLength(0);
    expect(await mod.saveQuizResponse({} as never, row(), NOW)).toBe("created");
    expect(data.kajabiQuizResponses[0]).toMatchObject({ quiz_kajabi_id: "489121", submission_key: "9001", email: ADA, captured_at: NOW.toISOString(), deleted_at: null });
    expect(await mod.saveQuizResponse({} as never, row(), new Date("2027-02-04T00:00:00.000Z"))).toBe("unchanged");
    expect(await mod.saveQuizResponse({} as never, row({ answers: [{ questionKey: "11", prompt: "P", text: "more words", optionKeys: [], optionLabels: [], file: null }] }), NOW)).toBe("updated");
    // A copy that arrives later is stored too, without a new capture of the words.
    const withCopy = row({ answers: [{ questionKey: "11", prompt: "P", text: "more words", optionKeys: [], optionLabels: [], file: { name: "a.pdf", bytes: 1, sourceUrl: "https://x.test/a", storagePath: "kajabi-import/489121/9001/a.pdf", copyFailure: null } }] });
    expect(await mod.saveQuizResponse({} as never, withCopy, NOW)).toBe("updated");
    expect(await mod.saveQuizResponse({} as never, withCopy, NOW)).toBe("unchanged");
    expect(data.kajabiQuizResponses).toHaveLength(1);
    vi.doUnmock("@/lib/data/kajabi-courses");
  });
});

describe("copyResponseFiles", () => {
  const file = (name = "letter.pdf", sourceUrl: string | null = "https://x.test/f"): StoredAnswer => ({ questionKey: "13", prompt: null, text: null, optionKeys: [], optionLabels: [], file: { name, bytes: null, sourceUrl, storagePath: null, copyFailure: null } });
  const input = (answers: StoredAnswer[], previous: StoredAnswer[] = []) => ({ quizKajabiId: "489121", submissionKey: "9001", answers, previous });
  const io = (over: Partial<FileCopyIO> = {}): FileCopyIO & { stored: string[] } => {
    const stored: string[] = [];
    return {
      stored,
      download: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array(100), contentType: "application/pdf" })),
      upload: vi.fn(async (path: string) => {
        stored.push(path);
        return true;
      }),
      ...over,
    };
  };

  it("copies a file under the import prefix, never inside a member's folder, and records its size", async () => {
    const fileIO = io();
    const { answers, counts } = await copyResponseFiles(fileIO, checkQuizFile, input([file("My Letter.pdf")]), false);
    expect(fileIO.stored).toEqual(["kajabi-import/489121/9001/My_Letter.pdf"]);
    expect(answers[0].file).toMatchObject({ storagePath: "kajabi-import/489121/9001/My_Letter.pdf", bytes: 100, copyFailure: null });
    expect(counts).toEqual({ copied: 1, alreadyCopied: 0, failed: {} });
  });

  it("copies nothing in a dry run, but says what it would", async () => {
    const fileIO = io();
    const { answers, counts } = await copyResponseFiles(fileIO, checkQuizFile, input([file()]), true);
    expect(fileIO.upload).not.toHaveBeenCalled();
    expect(answers[0].file?.storagePath).toBeNull();
    expect(counts.copied).toBe(1);
  });

  it("keeps a copy already made for the same file, without downloading it again", async () => {
    const fileIO = io();
    const before: StoredAnswer = { ...file(), file: { name: "letter.pdf", bytes: 7, sourceUrl: "https://old.test/f", storagePath: "kajabi-import/489121/9001/letter.pdf", copyFailure: null } };
    const { answers, counts } = await copyResponseFiles(fileIO, checkQuizFile, input([file()], [before]), false);
    expect(fileIO.download).not.toHaveBeenCalled();
    expect(answers[0].file).toMatchObject({ storagePath: "kajabi-import/489121/9001/letter.pdf", bytes: 7 });
    expect(counts.alreadyCopied).toBe(1);
  });

  it("reports, by reason and never by name, what could not be copied", async () => {
    const big = io({ download: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array(10 * 1024 * 1024 + 1), contentType: null })) });
    expect((await copyResponseFiles(big, checkQuizFile, input([file()]), false)).counts.failed).toEqual({ too_big: 1 });
    expect((await copyResponseFiles(io(), checkQuizFile, input([file("run.exe")]), false)).counts.failed).toEqual({ type: 1 });
    expect((await copyResponseFiles(io(), checkQuizFile, input([file("a.pdf", null)]), false)).counts.failed).toEqual({ no_link: 1 });
    const gone = io({ download: vi.fn(async () => ({ ok: false as const, failure: "expired" as const })) });
    const result = await copyResponseFiles(gone, checkQuizFile, input([file()]), false);
    expect(result.counts.failed).toEqual({ expired: 1 });
    expect(result.answers[0].file).toMatchObject({ storagePath: null, copyFailure: "expired" });
    const empty = io({ download: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array(0), contentType: null })) });
    expect((await copyResponseFiles(empty, checkQuizFile, input([file()]), false)).counts.failed).toEqual({ empty: 1 });
    const refused = io({ upload: vi.fn(async () => false) });
    expect((await copyResponseFiles(refused, checkQuizFile, input([file()]), false)).counts.failed).toEqual({ storage: 1 });
  });

  it("passes answers without a file through untouched", async () => {
    const text: StoredAnswer = { questionKey: "11", prompt: null, text: "x", optionKeys: [], optionLabels: [], file: null };
    expect((await copyResponseFiles(io(), checkQuizFile, input([text]), false)).answers).toEqual([text]);
  });
});

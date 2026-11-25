/**
 * The quiz Results tab as the owner's probe of the live admin printed it (JSON:API, camelCase fields, answers in `included` that name a
 * question by title, type and position but carry no question id). Field names and types are the probe's; every value is invented.
 */
import { describe, expect, it } from "vitest";
import { ORG_TIMEZONE } from "@/lib/config";
import { parseKajabiInstant } from "@/lib/kajabi/progress-capture";
import { kindOfTypeName, pageMetaOf, parseSubmission, submissionsListedIn, typeValuesIn } from "@/lib/kajabi/quiz-responses";

const attributes = (over: Record<string, unknown> = {}) => ({
  contactEmail: "Ada.Example@Example.test",
  contactName: "Ada Example",
  dateSubmittedAt: "2026-05-10T22:38:00.000Z",
  answersCount: 4,
  correctAnswersCount: 0,
  score: null,
  passed: null,
  passingGradePercentage: null,
  feedback: null,
  publishedAt: null,
  autoPublish: false,
  ...over,
});

/** GET /api/admin/quizzes/:id/results */
const listPage = () => ({
  data: [
    { id: "5001", type: "quiz_results", attributes: attributes(), relationships: { answers: {}, quiz: { data: { id: "489121", type: "quizzes" } } } },
    { id: "5002", type: "quiz_results", attributes: attributes({ contactEmail: "bo.example@example.test", contactName: "Bo Example", dateSubmittedAt: "May 10, 2026 6:38 PM" }), relationships: { answers: {}, quiz: { data: { id: "489121", type: "quizzes" } } } },
  ],
  meta: { currentPage: 1, itemsTotalCount: 2, pageCount: 1, pageSize: null },
});

const answer = (id: string, a: Record<string, unknown>) => ({
  id,
  type: "quiz_result_answers",
  attributes: { answer: null, fileUrl: null, questionTitle: "A question", questionType: "short_answer", questionPosition: 1, questionImageFileUrl: null, correct: null, feedback: null, isGradable: true, gradeCanBeChanged: true, ...a },
  relationships: { choices: { data: [] }, result: { data: { id: "5001", type: "quiz_results" } } },
});

/** GET /api/admin/quizzes/:id/results/:id */
const submission = () => ({
  data: {
    id: "5001",
    type: "quiz_results",
    attributes: attributes(),
    relationships: { answers: { data: [{ id: "a1", type: "quiz_result_answers" }, { id: "a2", type: "quiz_result_answers" }, { id: "a3", type: "quiz_result_answers" }, { id: "a4", type: "quiz_result_answers" }] }, quiz: { data: { id: "489121", type: "quizzes" } } },
  },
  included: [
    answer("a1", { answer: "<p>The ending.</p><p>And the start.</p>", questionTitle: "What stood out?", questionType: "short_answer", questionPosition: 1 }),
    answer("a2", { answer: "Hard", questionTitle: "How did it feel?", questionType: "multiple_choice", questionPosition: 2 }),
    answer("a3", { fileUrl: "https://files.example.test/uploads/My%20Letter.pdf?X-Amz-Signature=abc", questionTitle: "Upload your letter", questionType: "file_upload", questionPosition: 3 }),
    answer("a4", { questionTitle: "Anything else?", questionType: "short_answer", questionPosition: 4 }),
  ],
});

describe("the Results list, as the live admin sends it", () => {
  it("reads each row's email (lower case) and submit date, in ISO and in the admin's own words, and keeps no name", () => {
    const refs = submissionsListedIn([listPage()]);
    expect(refs).toEqual([
      { submissionKey: "5001", email: "ada.example@example.test", submittedAt: "2026-05-10T22:38:00.000Z" },
      // 6:38 PM on the org's wall clock (Eastern, daylight time in May).
      { submissionKey: "5002", email: "bo.example@example.test", submittedAt: "2026-05-10T22:38:00.000Z" },
    ]);
    expect(JSON.stringify(refs)).not.toMatch(/Ada Example|Bo Example/);
  });

  it("reads the paging from its own meta", () => {
    expect(pageMetaOf([listPage()])).toEqual({ currentPage: 1, pageCount: 1, itemsTotalCount: 2 });
    expect(pageMetaOf([{ ...listPage(), meta: { currentPage: 2, pageCount: 5, itemsTotalCount: 41, pageSize: null } }])).toEqual({ currentPage: 2, pageCount: 5, itemsTotalCount: 41 });
    expect(pageMetaOf([{ data: [] }, { meta: { currentPage: "1" } }])).toBeNull();
  });
});

describe("one submission, as the live admin sends it", () => {
  it("reads the responder, the date and every answer; a question with no id is keyed by its position, wording kept", () => {
    const parsed = parseSubmission([submission()], "5001")!;
    expect(parsed).toMatchObject({ submissionKey: "5001", email: "ada.example@example.test", submittedAt: "2026-05-10T22:38:00.000Z" });
    expect(parsed.answers.map((a) => [a.questionKey, a.position, a.prompt, a.questionType])).toEqual([
      ["pos:1", 1, "What stood out?", "short_answer"],
      ["pos:2", 2, "How did it feel?", "multiple_choice"],
      ["pos:3", 3, "Upload your letter", "file_upload"],
    ]);
    expect(parsed.answers[0]).toMatchObject({ text: "The ending.\nAnd the start.", optionLabels: [], file: null });
  });

  it("takes a choice's text from the answer, and a file's link from fileUrl with a name from its address", () => {
    const parsed = parseSubmission([submission()], "5001")!;
    expect(parsed.answers[1]).toMatchObject({ text: null, optionLabels: ["Hard"], optionKeys: [] });
    expect(parsed.answers[2].file).toEqual({ name: "My Letter.pdf", bytes: null, sourceUrl: "https://files.example.test/uploads/My%20Letter.pdf?X-Amz-Signature=abc" });
    expect(parsed.answers[2].text).toBeNull();
  });

  it("leaves a question with a null answer out, and never keeps the responder's name", () => {
    const parsed = parseSubmission([submission()], "5001")!;
    expect(parsed.answers.some((a) => a.position === 4)).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("Ada Example");
  });

  it("splits several chosen answers onto their own labels, and accepts choices that come with text", () => {
    const many = submission();
    (many.included[1].attributes as { answer: string | null }).answer = "Easy\nHard";
    expect(parseSubmission([many], "5001")!.answers[1].optionLabels).toEqual(["Easy", "Hard"]);

    const withChoices = submission();
    withChoices.included[1].attributes.answer = null as never;
    withChoices.included[1].relationships.choices = { data: [{ id: "c7", type: "quiz_choices" }] } as never;
    const doc = { ...withChoices, included: [...withChoices.included, { id: "c7", type: "quiz_choices", attributes: { text: "Hard" } }] };
    expect(parseSubmission([doc], "5001")!.answers[1]).toMatchObject({ optionKeys: ["c7"], optionLabels: ["Hard"] });
  });

  it("works when the included answers carry no type, and when the answer text is the only thing the type says nothing about", () => {
    const untyped = submission();
    for (const a of untyped.included) delete (a as { type?: string }).type;
    expect(parseSubmission([untyped], "5001")!.answers).toHaveLength(3);
    const odd = submission();
    odd.included[0].attributes.questionType = "essay_question";
    expect(parseSubmission([odd], "5001")!.answers[0].text).toBe("The ending.\nAnd the start.");
  });

  it("uses the key the capture knows it by, else the submission's own id", () => {
    expect(parseSubmission([submission()], null)!.submissionKey).toBe("5001");
    expect(parseSubmission([submission()], "from-the-address")!.submissionKey).toBe("from-the-address");
  });
});

describe("what a type name says", () => {
  it("recognises Kajabi's names for the three kinds, tolerantly", () => {
    for (const t of ["short_answer", "short answer", "ShortAnswer", "free_text", "text"]) expect(kindOfTypeName(t)).toBe("short_answer");
    for (const t of ["file_upload", "File upload", "FileUpload", "file", "attachment"]) expect(kindOfTypeName(t)).toBe("file_upload");
    for (const t of ["multiple_choice", "Multiple choice", "checkboxes", "checkbox", "MultipleChoice", "single_choice", "radio"]) expect(kindOfTypeName(t)).toBe("choice");
    expect(kindOfTypeName("mystery")).toBeNull();
    expect(kindOfTypeName(null)).toBeNull();
  });

  it("lists the distinct type and questionType values a capture saw, and only enum-like ones", () => {
    const seen = typeValuesIn([submission(), { data: { type: "quiz_results", attributes: { questionType: "free text with a long sentence that is clearly not an enum name at all, so not printed" } } }]);
    expect(seen.types).toEqual(["quiz_result_answers", "quiz_results", "quizzes"]);
    expect(seen.questionTypes).toEqual(["file_upload", "multiple_choice", "short_answer"]);
  });
});

describe("parseKajabiInstant, for the dates the admin shows", () => {
  const z = ORG_TIMEZONE;
  it("reads ISO, and the admin's own words as the org's wall clock, in and out of daylight time", () => {
    expect(parseKajabiInstant("2026-05-10T22:38:00.000Z", z)).toBe("2026-05-10T22:38:00.000Z");
    expect(parseKajabiInstant("May 10, 2026 6:38 PM", z)).toBe("2026-05-10T22:38:00.000Z");
    expect(parseKajabiInstant("Jan 5, 2027 6:38 PM", z)).toBe("2027-01-05T23:38:00.000Z");
    expect(parseKajabiInstant("May 10, 2026 12:05 AM", z)).toBe("2026-05-10T04:05:00.000Z");
    expect(parseKajabiInstant("May 10, 2026 12:05 PM", z)).toBe("2026-05-10T16:05:00.000Z");
    expect(parseKajabiInstant("May 10, 2026 18:38", z)).toBe("2026-05-10T22:38:00.000Z");
    expect(parseKajabiInstant("September 3, 2026", z)).toBe("2026-09-03T16:00:00.000Z");
  });

  it("is null for what isn't a date", () => {
    for (const bad of ["Smarch 10, 2026 6:38 PM", "Feb 30, 2026 6:38 PM", "May 10, 2026 13:38 PM", "May 10, 2026 6:61 PM", "yesterday", "", 5, null]) expect(parseKajabiInstant(bad, z)).toBeNull();
  });
});

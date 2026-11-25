/**
 * A choice question as Kajabi's single-submission document sends it: every choice of the question is its own `included` record (with its
 * title, place and whether it was `selected`), and the answer record lists them all under `relationships.choices`. Only the selected
 * ones are what the member picked. Field names are the owner's; every value is invented.
 */
import { describe, expect, it } from "vitest";
import { answersToJson, parseSubmission } from "@/lib/kajabi/quiz-responses";
import { mapAnswer } from "@/lib/courses/quiz-response-import";
import type { StoredAnswer } from "@/lib/kajabi/quiz-responses";

const base = { answer: null as string | null, fileUrl: null, questionImageFileUrl: null, correct: null, feedback: null, isGradable: true, gradeCanBeChanged: true };

const choice = (id: string, question: { title: string; position: number; type?: string }, c: { title: string; position: number; selected?: boolean; image?: string | null }, answerId: string, siblings: string[]) => ({
  id,
  type: "quiz_result_choices",
  attributes: {
    ...base,
    questionTitle: question.title,
    questionPosition: question.position,
    questionType: question.type ?? "multiple_choice",
    choiceTitle: c.title,
    choicePosition: c.position,
    choiceImageFileUrl: c.image ?? null,
    ...(c.selected === undefined ? {} : { selected: c.selected }),
  },
  relationships: { answer: { data: { id: answerId, type: "quiz_result_answers" } }, choices: { data: siblings.map((s) => ({ id: s, type: "quiz_result_choices" })) }, result: { data: { id: "5001", type: "quiz_results" } } },
});

/** The answer record of a question: `answer` null, and every one of its choices listed. */
const answerRecord = (id: string, question: { title: string; position: number; type?: string }, choiceIds: string[], text: string | null = null) => ({
  id,
  type: "quiz_result_answers",
  attributes: { ...base, answer: text, questionTitle: question.title, questionPosition: question.position, questionType: question.type ?? "multiple_choice" },
  relationships: { choices: { data: choiceIds.map((c) => ({ id: c, type: "quiz_result_choices" })) }, result: { data: { id: "5001", type: "quiz_results" } } },
});

const doc = (included: unknown[]) => ({
  data: { id: "5001", type: "quiz_results", attributes: { contactEmail: "Ada.Example@Example.test", contactName: "Ada Example", dateSubmittedAt: "2026-05-10T22:38:00.000Z" }, relationships: { answers: { data: [] }, quiz: { data: { id: "489124", type: "quizzes" } } } },
  included,
});

const Q1 = { title: "How did it feel?", position: 1 };
const Q2 = { title: "Which of these apply?", position: 2, type: "checkboxes" };

describe("a single choice question", () => {
  const included = [
    answerRecord("a1", Q1, ["c1", "c2", "c3"]),
    choice("c1", Q1, { title: "Easy", position: 1, selected: false }, "a1", ["c1", "c2", "c3"]),
    choice("c2", Q1, { title: "Hard", position: 2, selected: true }, "a1", ["c1", "c2", "c3"]),
    choice("c3", Q1, { title: "Both", position: 3, selected: false, image: null }, "a1", ["c1", "c2", "c3"]),
  ];

  it("is the one choice that was selected, by its title, never every choice the answer lists", () => {
    const parsed = parseSubmission([doc(included)], "5001")!;
    expect(parsed.answers).toHaveLength(1);
    expect(parsed.answers[0]).toMatchObject({ questionKey: "pos:1", prompt: "How did it feel?", position: 1, questionType: "multiple_choice", optionKeys: [], optionLabels: ["Hard"], text: null, file: null });
  });

  it("stores only the selected label in Bronze, no choice ids and no unselected wording", () => {
    const stored = JSON.stringify(answersToJson(parseSubmission([doc(included)], "5001")!.answers.map((a) => ({ ...a, file: null }))));
    expect(stored).toContain("Hard");
    expect(stored).not.toMatch(/Easy|Both|c1|c2|c3/);
  });

  it("is the same whether the choices come as their own records only or are also resolved under the answer", () => {
    const withoutAnswerRecord = parseSubmission([doc(included.slice(1))], "5001")!;
    expect(withoutAnswerRecord.answers[0]).toMatchObject({ questionKey: "pos:1", optionLabels: ["Hard"], optionKeys: [] });
  });
});

describe("a checkbox question", () => {
  it("lists every selected choice, in the order of their positions, and not the others", () => {
    const ids = ["d1", "d2", "d3", "d4"];
    const included = [
      answerRecord("a2", Q2, ids),
      choice("d1", Q2, { title: "Fourth", position: 4, selected: true }, "a2", ids),
      choice("d2", Q2, { title: "First", position: 1, selected: true }, "a2", ids),
      choice("d3", Q2, { title: "Second", position: 2, selected: false }, "a2", ids),
      choice("d4", Q2, { title: "Third", position: 3, selected: false }, "a2", ids),
    ];
    const parsed = parseSubmission([doc(included)], "5001")!;
    expect(parsed.answers).toHaveLength(1);
    expect(parsed.answers[0]).toMatchObject({ questionKey: "pos:2", questionType: "checkboxes", optionLabels: ["First", "Fourth"], optionKeys: [] });
  });
});

describe("a choice question with nothing selected", () => {
  const ids = ["e1", "e2"];
  const none = [answerRecord("a3", Q1, ids), choice("e1", Q1, { title: "Easy", position: 1, selected: false }, "a3", ids), choice("e2", Q1, { title: "Hard", position: 2, selected: false }, "a3", ids)];

  it("is no answer at all, not a pick of everything", () => {
    const text = answerRecord("a4", { title: "Anything else?", position: 3, type: "short_answer" }, [], "Some words.");
    const parsed = parseSubmission([doc([...none, text])], "5001")!;
    expect(parsed.answers.map((a) => a.questionKey)).toEqual(["pos:3"]);
  });

  it("is still a submission, with no answers, when it is all there is: someone did submit", () => {
    expect(parseSubmission([doc(none)], "5001")).toMatchObject({ submissionKey: "5001", email: "ada.example@example.test", answers: [] });
  });

  it("keeps the answer's own text when it has one and no choice is marked selected", () => {
    const withText = [answerRecord("a3", Q1, ids, "Hard"), ...none.slice(1)];
    expect(parseSubmission([doc(withText)], "5001")!.answers[0]).toMatchObject({ optionLabels: ["Hard"], optionKeys: [], text: null });
  });
});

describe("two questions in one submission", () => {
  it("reads each question's picks apart", () => {
    const i1 = ["c1", "c2"];
    const i2 = ["d1", "d2"];
    const included = [
      answerRecord("a1", Q1, i1),
      answerRecord("a2", Q2, i2),
      choice("c1", Q1, { title: "Easy", position: 1, selected: true }, "a1", i1),
      choice("c2", Q1, { title: "Hard", position: 2, selected: false }, "a1", i1),
      choice("d1", Q2, { title: "Alpha", position: 1, selected: false }, "a2", i2),
      choice("d2", Q2, { title: "Beta", position: 2, selected: true }, "a2", i2),
    ];
    const answers = parseSubmission([doc(included)], "5001")!.answers;
    expect(answers.map((a) => [a.questionKey, a.optionLabels])).toEqual([["pos:1", ["Easy"]], ["pos:2", ["Beta"]]]);
  });
});

describe("a choice record with no `selected` field at all", () => {
  it("is left to the older reading: the answer's own list of choices", () => {
    const included = [
      { id: "a1", type: "quiz_result_answers", attributes: { ...base, questionTitle: "How?", questionPosition: 1, questionType: "multiple_choice", answer: "Hard" }, relationships: { choices: { data: [] } } },
      choice("c1", Q1, { title: "Easy", position: 1 }, "a1", ["c1"]),
    ];
    const parsed = parseSubmission([doc(included)], "5001")!;
    expect(parsed.answers[0]).toMatchObject({ questionKey: "pos:1", optionLabels: ["Hard"] });
  });
});

describe("mapping a picked label to the Hub's question", () => {
  const stored = (labels: string[]): StoredAnswer => ({ questionKey: "pos:1", prompt: "How did it feel?", text: null, optionKeys: [], optionLabels: labels, file: null, position: 1, questionType: "multiple_choice" });
  const question = { id: "qques_1", quizId: "q", position: 1, prompt: "How did it feel?", kind: "choice" as const, graded: false, allowsMultiple: true, sourceKey: "e-1", options: [{ id: "qopt_1", position: 1, label: "Easy", isCorrect: false, sourceKey: "o1" }, { id: "qopt_2", position: 2, label: "Hard", isCorrect: false, sourceKey: "o2" }] };

  it("maps by wording, several at once, in the question's order", () => {
    expect(mapAnswer(question, stored(["hard", "EASY"]))).toMatchObject({ ok: true, selectedOptionIds: ["qopt_1", "qopt_2"], answerText: null });
  });

  it("keeps what was picked as text when no option has that wording, and never picks an option for them", () => {
    expect(mapAnswer(question, stored(["Something reworded"]))).toMatchObject({ ok: true, selectedOptionIds: [], answerText: "Something reworded" });
    expect(mapAnswer(question, stored(["Hard", "Something reworded"]))).toMatchObject({ selectedOptionIds: ["qopt_2"], answerText: null });
  });

  it("has nothing to keep when nothing was picked", () => {
    expect(mapAnswer(question, stored([]))).toEqual({ ok: false });
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { blankQuestion, checkQuestion, isQuestionId, markCorrect, parsePassingPercent, QUIZ_LIMITS, withAllowsMultiple, type QuestionDraft } from "@/lib/courses/quiz-editor";

const draft = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  prompt: "How are you?",
  allowsMultiple: false,
  options: [{ label: "Fine", isCorrect: true }, { label: "Tired", isCorrect: false }],
  ...over,
});

describe("checkQuestion", () => {
  it("trims a whole question, drops the blank answers people leave while typing and keeps the ids of existing ones", () => {
    const result = checkQuestion(draft({ prompt: "  How are you?  ", options: [{ id: "qopt_AAAAAAAAAAA1", label: " Fine ", isCorrect: true }, { label: "", isCorrect: false }, { label: "Tired", isCorrect: false }] }));
    expect(result).toEqual({
      ok: true,
      input: { prompt: "How are you?", allowsMultiple: false, options: [{ id: "qopt_AAAAAAAAAAA1", label: "Fine", isCorrect: true }, { label: "Tired", isCorrect: false }] },
    });
  });

  it("says what is missing, in plain words", () => {
    expect(checkQuestion(draft({ prompt: "   " }))).toEqual({ ok: false, error: "Write the question." });
    expect(checkQuestion(draft({ options: [{ label: "Only", isCorrect: true }, { label: " ", isCorrect: false }] }))).toEqual({ ok: false, error: "Give at least 2 answers to choose from." });
    expect(checkQuestion(draft({ options: [{ label: "A", isCorrect: false }, { label: "B", isCorrect: false }] }))).toEqual({ ok: false, error: "Mark the right answer." });
    expect(checkQuestion(draft({ options: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: true }] }))).toEqual({ ok: false, error: "Only one answer can be right unless members may choose several." });
    expect(checkQuestion(draft({ prompt: "x".repeat(QUIZ_LIMITS.prompt + 1) })).ok).toBe(false);
    expect(checkQuestion(draft({ options: [{ label: "x".repeat(QUIZ_LIMITS.option + 1), isCorrect: true }, { label: "B", isCorrect: false }] })).ok).toBe(false);
    expect(checkQuestion(draft({ options: Array.from({ length: QUIZ_LIMITS.optionsMax + 1 }, (_, i) => ({ label: `o${i}`, isCorrect: i === 0 })) })).ok).toBe(false);
  });

  it("accepts several right answers when members may choose several", () => {
    expect(checkQuestion(draft({ allowsMultiple: true, options: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: true }, { label: "C", isCorrect: false }] })).ok).toBe(true);
  });

  it("only ever returns questions the database's save function accepts (property)", () => {
    const option = fc.record({ label: fc.string({ maxLength: 40 }), isCorrect: fc.boolean() });
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.boolean(), fc.array(option, { maxLength: 15 }), (prompt, allowsMultiple, options) => {
        const result = checkQuestion({ prompt, allowsMultiple, options });
        if (!result.ok) return;
        const { input } = result;
        const right = input.options.filter((o) => o.isCorrect).length;
        expect(input.prompt.length).toBeGreaterThan(0);
        expect(input.options.length).toBeGreaterThanOrEqual(QUIZ_LIMITS.optionsMin);
        expect(input.options.length).toBeLessThanOrEqual(QUIZ_LIMITS.optionsMax);
        expect(input.options.every((o) => o.label.length > 0 && o.label === o.label.trim())).toBe(true);
        expect(right).toBeGreaterThanOrEqual(1);
        if (!input.allowsMultiple) expect(right).toBe(1);
      }),
      { numRuns: 400 },
    );
  });
});

describe("the form's helpers", () => {
  it("starts a new question with two empty answers and the first one marked", () => {
    expect(blankQuestion()).toEqual({ prompt: "", allowsMultiple: false, options: [{ label: "", isCorrect: true }, { label: "", isCorrect: false }] });
  });

  it("keeps only the first right answer when members may no longer choose several", () => {
    const many = draft({ allowsMultiple: true, options: [{ label: "A", isCorrect: false }, { label: "B", isCorrect: true }, { label: "C", isCorrect: true }] });
    expect(withAllowsMultiple(many, false).options.map((o) => o.isCorrect)).toEqual([false, true, false]);
    expect(withAllowsMultiple(many, true)).toEqual(many);
    const one = draft();
    expect(withAllowsMultiple(one, true)).toEqual({ ...one, allowsMultiple: true });
  });

  it("marks one right answer for a single-answer question and any number for a multiple-answer one", () => {
    const single = draft({ options: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: false }] });
    expect(markCorrect(single, 1, true).options.map((o) => o.isCorrect)).toEqual([false, true]);
    const multiple = draft({ allowsMultiple: true, options: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: false }] });
    expect(markCorrect(multiple, 1, true).options.map((o) => o.isCorrect)).toEqual([true, true]);
    expect(markCorrect(multiple, 0, false).options.map((o) => o.isCorrect)).toEqual([false, false]);
  });
});

describe("parsePassingPercent", () => {
  it("reads nothing as not graded and a whole percent from 1 to 100", () => {
    expect(parsePassingPercent("")).toEqual({ ok: true, passingPercent: null });
    expect(parsePassingPercent("  ")).toEqual({ ok: true, passingPercent: null });
    expect(parsePassingPercent("70")).toEqual({ ok: true, passingPercent: 70 });
    expect(parsePassingPercent(" 80 % ")).toEqual({ ok: true, passingPercent: 80 });
    expect(parsePassingPercent("1")).toEqual({ ok: true, passingPercent: 1 });
    expect(parsePassingPercent("100")).toEqual({ ok: true, passingPercent: 100 });
  });

  it("refuses everything else", () => {
    for (const bad of ["0", "101", "-5", "7.5", "seventy", "1e2", "1000", "5 5"]) {
      expect(parsePassingPercent(bad)).toEqual({ ok: false, error: "Use a whole number from 1 to 100." });
    }
  });
});

describe("isQuestionId", () => {
  it("accepts a question id and nothing else", () => {
    expect(isQuestionId("qques_AAAAAAAAAAA1")).toBe(true);
    expect(isQuestionId("qopt_AAAAAAAAAAA1")).toBe(false);
    expect(isQuestionId("qques_0OIlAAAAAAAA")).toBe(false);
    expect(isQuestionId(undefined)).toBe(false);
    expect(isQuestionId(7)).toBe(false);
  });
});

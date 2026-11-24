import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { blankQuestion, checkQuestion, hasGradedQuestions, markCorrect, withGraded, withKind } from "@/lib/courses/quiz-editor";

describe("questions that are not graded in the builder", () => {
  it("starts a short answer or a file upload with nothing to choose and nothing graded", () => {
    expect(blankQuestion("short_answer")).toEqual({ prompt: "", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
    expect(blankQuestion("file_upload")).toMatchObject({ kind: "file_upload", graded: false, options: [] });
  });

  it("checks a short answer or a file upload on its words alone, dropping any options and grading", () => {
    expect(checkQuestion({ prompt: "  Why?  ", kind: "short_answer", graded: true, allowsMultiple: true, options: [{ label: "x", isCorrect: true }] })).toEqual({
      ok: true,
      input: { prompt: "Why?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] },
    });
    expect(checkQuestion({ ...blankQuestion("file_upload"), prompt: "" })).toEqual({ ok: false, error: "Write the question." });
    expect(checkQuestion({ ...blankQuestion("file_upload"), prompt: "x".repeat(1001) })).toMatchObject({ ok: false });
  });

  it("needs no right answer on a choice question that is not graded, and drops the marks it had", () => {
    const result = checkQuestion({ prompt: "How was it?", kind: "choice", graded: false, allowsMultiple: false, options: [{ label: "Easy", isCorrect: true }, { label: "Hard", isCorrect: true }] });
    expect(result).toEqual({ ok: true, input: { prompt: "How was it?", kind: "choice", graded: false, allowsMultiple: false, options: [{ label: "Easy", isCorrect: false }, { label: "Hard", isCorrect: false }] } });
  });

  it("still needs two answers on a choice question that is not graded, and a right one when it is graded", () => {
    expect(checkQuestion({ prompt: "q", kind: "choice", graded: false, allowsMultiple: false, options: [{ label: "Only", isCorrect: false }] })).toMatchObject({ ok: false });
    expect(checkQuestion({ prompt: "q", kind: "choice", graded: true, allowsMultiple: false, options: [{ label: "A", isCorrect: false }, { label: "B", isCorrect: false }] })).toEqual({ ok: false, error: "Mark the right answer." });
  });

  it("switches a new question's kind keeping its words, and grading on and off for a choice question", () => {
    const choice = { ...blankQuestion(), prompt: "Words" };
    expect(withKind(choice, "short_answer")).toEqual({ prompt: "Words", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
    expect(withKind(choice, "choice")).toBe(choice);
    const off = withGraded(choice, false);
    expect(off.graded).toBe(false);
    expect(off.options.every((o) => !o.isCorrect)).toBe(true);
    expect(withGraded(off, true).options.map((o) => o.isCorrect)).toEqual([true, false]);
    expect(withGraded(choice, true)).toBe(choice);
    const open = blankQuestion("file_upload");
    expect(withGraded(open, true)).toBe(open);
  });

  it("knows whether any question counts toward a score", () => {
    const choice = { kind: "choice" as const, graded: true, options: [{ isCorrect: true }, { isCorrect: false }] };
    expect(hasGradedQuestions([])).toBe(false);
    expect(hasGradedQuestions([choice])).toBe(true);
    expect(hasGradedQuestions([{ ...choice, graded: false }])).toBe(false);
    expect(hasGradedQuestions([{ ...choice, options: [{ isCorrect: false }] }])).toBe(false);
    expect(hasGradedQuestions([{ kind: "short_answer", graded: false, options: [] }, { kind: "file_upload", graded: false, options: [] }])).toBe(false);
  });

  it("(property) a checked question is always one the database accepts: ungraded has no marks, open has no options", () => {
    const optionArb = fc.record({ label: fc.string({ maxLength: 20 }), isCorrect: fc.boolean() });
    const draftArb = fc.record({
      prompt: fc.string({ maxLength: 30 }),
      kind: fc.constantFrom("choice" as const, "short_answer" as const, "file_upload" as const),
      graded: fc.boolean(),
      allowsMultiple: fc.boolean(),
      options: fc.array(optionArb, { maxLength: 14 }),
    });
    fc.assert(
      fc.property(draftArb, (d) => {
        const checked = checkQuestion(d);
        if (!checked.ok) return;
        const { input } = checked;
        if (input.kind !== "choice") {
          expect(input.options).toEqual([]);
          expect(input.graded).toBe(false);
          expect(input.allowsMultiple).toBe(false);
          return;
        }
        expect(input.options.length).toBeGreaterThanOrEqual(2);
        const right = input.options.filter((o) => o.isCorrect).length;
        if (input.graded) expect(input.allowsMultiple ? right >= 1 : right === 1).toBe(true);
        else expect(right).toBe(0);
      }),
      { numRuns: 400 },
    );
  });

  it("marks answers right the same way when the form is a full draft", () => {
    expect(markCorrect(blankQuestion(), 1, true).options.map((o) => o.isCorrect)).toEqual([false, true]);
  });
});

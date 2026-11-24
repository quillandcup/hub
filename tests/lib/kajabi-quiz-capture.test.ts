import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryKajabiCourseRepository } from "@/lib/data/kajabi-courses";
import { documentsOf, embeddedDocuments, importedQuizOf, parseKajabiQuiz, plainText, quizContentHash, quizIdOfRedirect, retireQuizzesOfLesson, saveQuizCapture } from "@/lib/kajabi/quiz-capture";

// The sample quiz ("Let's Check In": three questions, no passing grade; one answer reads "Both B and C"), in the shapes
// Kajabi's admin might deliver it. The real shape is unverified (src/lib/kajabi/quiz-capture.ts), so each is a fixture.
const jsonApiQuiz = (extra: Record<string, unknown> = {}) => ({
  data: {
    id: "1573355",
    type: "quizzes",
    attributes: { title: "Let's Check In", ...extra },
    relationships: { questions: { data: [{ id: "11", type: "quiz_questions" }, { id: "12", type: "quiz_questions" }, { id: "13", type: "quiz_questions" }] } },
  },
  included: [
    { id: "13", type: "quiz_questions", attributes: { body: "<p>Pick the writing days &amp; more</p>", position: 3, allowMultiple: true }, relationships: { answers: { data: [{ id: "131", type: "quiz_answers" }, { id: "132", type: "quiz_answers" }, { id: "133", type: "quiz_answers" }] } } },
    { id: "11", type: "quiz_questions", attributes: { body: "How do you feel?", position: 1 }, relationships: { answers: { data: [{ id: "111", type: "quiz_answers" }, { id: "112", type: "quiz_answers" }] } } },
    { id: "12", type: "quiz_questions", attributes: { body: "Which are true?", position: 2 }, relationships: { answers: { data: [{ id: "121", type: "quiz_answers" }, { id: "122", type: "quiz_answers" }, { id: "123", type: "quiz_answers" }] } } },
    { id: "111", type: "quiz_answers", attributes: { text: "Great", correct: false, position: 1 } },
    { id: "112", type: "quiz_answers", attributes: { text: "Fine", correct: true, position: 2 } },
    { id: "121", type: "quiz_answers", attributes: { text: "A", correct: false } },
    { id: "122", type: "quiz_answers", attributes: { text: "B", correct: false } },
    { id: "123", type: "quiz_answers", attributes: { text: "Both B and C", correct: true } },
    { id: "131", type: "quiz_answers", attributes: { text: "Monday", correct: true } },
    { id: "132", type: "quiz_answers", attributes: { text: "Tuesday", correct: false } },
    { id: "133", type: "quiz_answers", attributes: { text: "Wednesday", correct: true } },
  ],
});

describe("parseKajabiQuiz", () => {
  it("reads the sample quiz from a JSON:API document: questions in order, answers, the right ones, no passing grade", () => {
    const parsed = parseKajabiQuiz([jsonApiQuiz()])!;
    expect(parsed.passingPercent).toBeNull();
    expect(parsed.hideAnswers).toBe(false);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.questions.map((q) => [q.id, q.prompt, q.allowsMultiple, q.options.map((o) => [o.id, o.label, o.isCorrect])])).toEqual([
      ["11", "How do you feel?", false, [["111", "Great", false], ["112", "Fine", true]]],
      ["12", "Which are true?", false, [["121", "A", false], ["122", "B", false], ["123", "Both B and C", true]]],
      ["13", "Pick the writing days & more", true, [["131", "Monday", true], ["132", "Tuesday", false], ["133", "Wednesday", true]]],
    ]);
  });

  it("reads the settings: a passing grade (a percent, a fraction, or switched off) and hidden answers", () => {
    expect(parseKajabiQuiz([jsonApiQuiz({ passingGrade: 80, hideAnswers: true })])).toMatchObject({ passingPercent: 80, hideAnswers: true });
    expect(parseKajabiQuiz([jsonApiQuiz({ passing_score: "70" })])).toMatchObject({ passingPercent: 70 });
    expect(parseKajabiQuiz([jsonApiQuiz({ passing_grade: 0.75 })])).toMatchObject({ passingPercent: 75 });
    expect(parseKajabiQuiz([jsonApiQuiz({ passing_grade: 80, passing_grade_enabled: false })])).toMatchObject({ passingPercent: null });
    expect(parseKajabiQuiz([jsonApiQuiz({ passing_grade: 0 })])).toMatchObject({ passingPercent: null, warnings: [] });
    const outOfRange = parseKajabiQuiz([jsonApiQuiz({ passing_grade: 250 })])!;
    expect(outOfRange.passingPercent).toBeNull();
    expect(outOfRange.warnings).toEqual(["the passing grade was out of range, so the quiz is not graded"]);
    expect(parseKajabiQuiz([jsonApiQuiz({ hide_answers: false })])).toMatchObject({ hideAnswers: false });
  });

  it("reads plain nested JSON the same way, wherever the questions sit", () => {
    const plain = {
      store: {
        quiz: {
          settings: { passing_grade: 90, hide_correct_answers: true },
          quiz_questions: [
            { id: 5, question: "One?", order: 2, choices: [{ id: 51, answer: "x", is_correct: true }, { id: 52, answer: "y", is_correct: false }] },
            { id: 4, question: "Zero?", order: 1, choices: [{ id: 41, answer: "p", is_correct: false }, { id: 42, answer: "q", is_correct: true }] },
          ],
        },
      },
    };
    const parsed = parseKajabiQuiz([plain])!;
    expect(parsed).toMatchObject({ passingPercent: 90, hideAnswers: true });
    expect(parsed.questions.map((q) => [q.id, q.prompt, q.options.filter((o) => o.isCorrect).map((o) => o.label)])).toEqual([["4", "Zero?", ["q"]], ["5", "One?", ["x"]]]);
  });

  it("reads a store that keeps the answers apart from their questions, each naming its question", () => {
    const store = {
      entities: {
        questions: { 1: { id: 1, prompt: "Where?" }, 2: { id: 2, prompt: "When?" } },
        answers: [
          { id: 10, question_id: 1, text: "Here", correct: true },
          { id: 11, question_id: 1, text: "There", correct: false },
          { id: 20, question_id: 2, text: "Now", correct: false },
          { id: 21, question_id: 2, text: "Later", correct: true },
        ],
      },
    };
    const parsed = parseKajabiQuiz([store])!;
    expect(parsed.questions.map((q) => [q.prompt, q.options.map((o) => o.label), q.options.filter((o) => o.isCorrect).map((o) => o.label)])).toEqual([
      ["Where?", ["Here", "There"], ["Here"]],
      ["When?", ["Now", "Later"], ["Later"]],
    ]);
  });

  it("takes the right answers from ids on the question when the answers carry no flag, and several right answers make the question multiple", () => {
    const doc = { questions: [{ id: 1, text: "Pick", correct_answer_ids: [11, 13], answers: [{ id: 11, text: "a" }, { id: 12, text: "b" }, { id: 13, text: "c" }] }] };
    const q = parseKajabiQuiz([doc])!.questions[0];
    expect(q.options.map((o) => o.isCorrect)).toEqual([true, false, true]);
    expect(q.allowsMultiple).toBe(true);
  });

  it("never guesses a right answer: a question whose answers carry no flag is kept, marked unscored, and said so", () => {
    const doc = { questions: [{ id: 1, text: "Open question?", answers: [{ id: 11, text: "a" }, { id: 12, text: "b" }] }] };
    const parsed = parseKajabiQuiz([doc])!;
    expect(parsed.questions[0].options.every((o) => !o.isCorrect)).toBe(true);
    expect(parsed.warnings).toEqual(["a question has no right answer marked in what was captured, so it is not scored"]);
  });

  it("reduces HTML in questions and answers to plain text", () => {
    const doc = { questions: [{ id: 1, text: "<p>What is <strong>2 &lt; 3</strong>?<br/>Think.</p>", answers: [{ id: 1, text: "<p>True&nbsp;&amp; sure</p>", correct: true }, { id: 2, text: "False", correct: false }] }] };
    const q = parseKajabiQuiz([doc])!.questions[0];
    expect(q.prompt).toBe("What is 2 < 3? Think.");
    expect(q.options[0].label).toBe("True & sure");
    expect(plainText(42)).toBe("");
    expect(plainText("<<b>script>alert(1)<</b>/script>ok")).toBe("alert(1)ok");
  });

  it("reads short answer and file upload questions as questions that are recorded, never scored", () => {
    const doc = { questions: [
      { id: 1, text: "Pick", question_type: "multiple_choice", answers: [{ id: 1, text: "a", correct: true }, { id: 2, text: "b" }] },
      { id: 2, text: "Tick", question_type: "checkboxes", answers: [{ id: 3, text: "a", correct: true }, { id: 4, text: "b", correct: true }] },
      { id: 3, text: "Write", question_type: "short_answer", graded: true },
      { id: 4, text: "Attach", type: "File upload", graded: false },
    ] };
    const parsed = parseKajabiQuiz([doc])!;
    expect(parsed.questions.map((q) => [q.id, q.kind, q.graded])).toEqual([["1", "choice", true], ["2", "choice", true], ["3", "short_answer", false], ["4", "file_upload", false]]);
    // Only the one Kajabi marks graded (by hand) is counted for the summary.
    expect(parsed.ungradedManual).toBe(1);
    expect(parseKajabiQuiz([{ questions: [{ id: 3, text: "Write", question_type: "short_answer" }] }])).toMatchObject({ ungradedManual: 0, questions: [{ id: "3", kind: "short_answer", graded: false, options: [] }] });
    expect(parseKajabiQuiz([jsonApiQuiz()])!.ungradedManual).toBe(0);
  });

  it("reads a choice question with the graded toggle off as not graded, with no right answer needed", () => {
    const parsed = parseKajabiQuiz([{ questions: [{ id: 7, text: "How do you feel?", question_type: "multiple_choice", graded: false, answers: [{ id: 1, text: "Fine" }, { id: 2, text: "Tired" }, { id: 3, text: "Great" }] }] }])!;
    expect(parsed.questions[0]).toMatchObject({ kind: "choice", graded: false });
    expect(parsed.warnings).toEqual([]);
    // The question's toggle is not the quiz's passing grade being on.
    expect(parsed.passingPercent).toBeNull();
    const { quiz } = importedQuizOf("489121", parsed);
    expect(quiz.questions[0]).toMatchObject({ kind: "choice", graded: false });
    expect(quiz.questions[0].options.every((o) => !o.isCorrect)).toBe(true);
  });

  it("imports open questions with no options and keeps choice questions that have two to twelve", () => {
    const parsed = parseKajabiQuiz([{ questions: [{ id: 1, text: "Write", question_type: "short_answer" }, { id: 2, text: "Attach", question_type: "file_upload" }, { id: 3, text: "Pick", question_type: "multiple_choice", answers: [{ id: 1, text: "only one" }] }] }])!;
    const { quiz, warnings } = importedQuizOf("9", parsed);
    expect(quiz.questions.map((q) => q.kind)).toEqual(["short_answer", "file_upload"]);
    expect(warnings).toEqual([]);
  });

  it("is null when no question with answers is in the documents", () => {
    for (const docs of [[], [null], [{}], [{ data: { id: "1", type: "quizzes", attributes: { title: "Empty" } } }], [{ questions: [{ id: 1, text: "Only one answer", answers: [{ text: "x" }] }] }], ["text", 7]]) {
      expect(parseKajabiQuiz(docs as unknown[])).toBeNull();
    }
  });

  it("copes with ids that aren't text or numbers (the property's first find: an id that is an object without a prototype)", () => {
    expect(parseKajabiQuiz([{ data: [{ id: Object.create(null), type: Object.create(null) }], included: [{ id: Object.create(null), type: "x" }] }])).toBeNull();
    const odd = { questions: [{ id: Object.create(null), text: "Q?", correct_answer_ids: [Object.create(null), 2], answers: [{ id: 1, text: "a" }, { id: 2, text: "b" }] }] };
    expect(parseKajabiQuiz([odd])!.questions[0]).toMatchObject({ id: "q1", options: [{ isCorrect: false }, { isCorrect: true }] });
  });

  it("never throws on any JSON (property)", () => {
    const json: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      value: fc.oneof({ depthSize: "small" }, fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.array(tie("value"), { maxLength: 4 }), fc.dictionary(fc.constantFrom("id", "type", "data", "included", "questions", "answers", "text", "correct", "attributes", "relationships", "position", "passing_grade"), tie("value"), { maxKeys: 5 })),
    })).value;
    fc.assert(fc.property(fc.array(json, { maxLength: 3 }), (docs) => {
      const parsed = parseKajabiQuiz(docs);
      if (parsed) {
        expect(parsed.questions.every((q) => q.prompt !== "" && q.options.length >= 2)).toBe(true);
        expect(parsed.passingPercent === null || (parsed.passingPercent >= 1 && parsed.passingPercent <= 100)).toBe(true);
      }
    }), { numRuns: 400 });
  });
});

describe("importedQuizOf", () => {
  it("keeps Kajabi's keys, and marks a question with several right answers as multiple", () => {
    const { quiz, warnings } = importedQuizOf("1573355", parseKajabiQuiz([jsonApiQuiz({ passing_grade: 60 })])!);
    expect(warnings).toEqual([]);
    expect(quiz).toMatchObject({ sourceKey: "1573355", passingPercent: 60, hideAnswers: false });
    expect(quiz.questions.map((q) => [q.sourceKey, q.allowsMultiple, q.options.map((o) => o.sourceKey)])).toEqual([["11", false, ["111", "112"]], ["12", false, ["121", "122", "123"]], ["13", true, ["131", "132", "133"]]]);
  });

  it("leaves out what the database would refuse, and says so: too few or too many answers, duplicates, over-long text", () => {
    const answers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `answer ${i + 1}`, correct: i === 0 }));
    const parsed = parseKajabiQuiz([{ questions: [{ id: "a", text: "x".repeat(1200), answers: [{ id: 1, text: "y".repeat(700), correct: true }, { id: 2, text: "z" }] }, { id: "b", text: "Too many", answers: answers(13) }, { id: "c", text: "Dupes", answers: [{ id: 1, text: "one", correct: true }, { id: 1, text: "one again" }, { id: 2, text: "two" }] }] }])!;
    const { quiz, warnings } = importedQuizOf("9", parsed);
    expect(quiz.questions.map((q) => q.sourceKey)).toEqual(["a", "c"]);
    expect(quiz.questions[0].prompt).toHaveLength(1000);
    expect(quiz.questions[0].options[0].label).toHaveLength(500);
    expect(quiz.questions[1].options.map((o) => o.label)).toEqual(["one", "two"]);
    expect(warnings).toEqual(["a question with 13 answers was left out (a question has two to twelve)"]);
  });
});

describe("the capture's small helpers", () => {
  it("finds the quiz id in the address a lesson's editor redirects to", () => {
    expect(quizIdOfRedirect("/admin/quizzes/1573355/edit")).toBe("1573355");
    expect(quizIdOfRedirect("https://app.kajabi.com/admin/quizzes/42")).toBe("42");
    for (const bad of [null, undefined, "", "/admin/posts/1/edit", "/admin/quizzes/", "https://[bad"]) expect(quizIdOfRedirect(bad)).toBeNull();
  });

  it("reads the JSON the editor page embeds, skipping a block that isn't JSON", () => {
    const html = `<html><script id="kjb-redux-store-data" type="application/json">{"a":1}</script><script id="kjb-redux-store-data">not json</script><script id="other">{"b":2}</script><script id="kjb-redux-store-data">[1,2]</script></html>`;
    expect(embeddedDocuments(html)).toEqual([{ a: 1 }, [1, 2]]);
    expect(embeddedDocuments("<html></html>")).toEqual([]);
  });

  describe("quizContentHash", () => {
    const withImage = (url: string, extra: Record<string, unknown> = {}) => {
      const doc = jsonApiQuiz(extra) as any;
      return [{ ...doc, thumbnailUrl: url, store: { posterImageUrl: url, other: [{ previewUrl: url }] } }];
    };

    it("ignores a different signature in an image URL and anything outside the parsed quiz", () => {
      expect(quizContentHash(withImage("https://cdn.example.com/a.png?Signature=aaa&Expires=1"))).toBe(quizContentHash(withImage("https://cdn.example.com/a.png?Signature=bbb&Expires=2")));
      expect(quizContentHash(withImage("https://cdn.example.com/a.png?Signature=aaa"))).toBe(quizContentHash([jsonApiQuiz()]));
    });

    it("changes with a question, an option, a right answer, the passing grade or hidden answers", () => {
      const base = quizContentHash([jsonApiQuiz()]);
      const edit = (fn: (doc: any) => void) => {
        const doc = jsonApiQuiz() as any;
        fn(doc);
        return quizContentHash([doc]);
      };
      const answer = (doc: any, id: string) => doc.included.find((i: any) => i.id === id);
      const results = [
        edit((d) => { d.included.find((i: any) => i.id === "11").attributes.body = "How are you feeling?"; }),
        edit((d) => { answer(d, "111").attributes.text = "Wonderful"; }),
        edit((d) => { answer(d, "111").attributes.correct = true; }),
        edit((d) => { answer(d, "112").attributes.correct = false; }),
        quizContentHash([jsonApiQuiz({ passing_grade: 70 })]),
        quizContentHash([jsonApiQuiz({ passing_grade: 80 })]),
        quizContentHash([jsonApiQuiz({ hide_answers: true })]),
      ];
      for (const r of results) expect(r).not.toBe(base);
      expect(new Set(results).size).toBe(results.length);
    });

    it("does not change when the response is reordered", () => {
      const doc = jsonApiQuiz() as any;
      const reordered = { included: [...doc.included].reverse(), data: { relationships: doc.data.relationships, attributes: doc.data.attributes, type: doc.data.type, id: doc.data.id } };
      expect(quizContentHash([reordered])).toBe(quizContentHash([doc]));
    });

    it("carries a scheme prefix, so a hash stored the old way (a bare digest) never matches", () => {
      expect(quizContentHash([jsonApiQuiz()])).toMatch(/^q2:[0-9a-f]{64}$/);
    });
  });

  it("gives the stored documents back, or none for a payload that isn't ours", () => {
    expect(documentsOf({ documents: [1, 2] })).toEqual([1, 2]);
    for (const bad of [null, [], "x", {}, { documents: "x" }]) expect(documentsOf(bad)).toEqual([]);
  });
});

describe("saving to Bronze", () => {
  const capture = (documents: unknown[] = [jsonApiQuiz()]) => ({ quizKajabiId: "1573355", courseKajabiId: "course-1", lessonKajabiId: "2200968704", documents });
  const NOW = new Date("2027-02-03T15:00:00.000Z");
  // The save goes through the Supabase repository; the twin stands in for it here.
  const withTwin = () => {
    const data = new InMemoryDataset();
    const twin = new InMemoryKajabiCourseRepository(data);
    return { data, twin };
  };

  it("writes a new quiz, then nothing for the same documents, then an update for changed ones (the repository's contract has its own tests)", async () => {
    const { data, twin } = withTwin();
    vi.resetModules();
    vi.doMock("@/lib/data/kajabi-courses", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/kajabi-courses")>()), SupabaseKajabiCourseRepository: class { constructor() { return twin; } } }));
    const mod = await import("@/lib/kajabi/quiz-capture");

    expect(await mod.saveQuizCapture({} as never, capture(), NOW)).toBe("created");
    expect(data.kajabiQuizzes).toHaveLength(1);
    expect(data.kajabiQuizzes[0]).toMatchObject({ kajabi_id: "1573355", course_kajabi_id: "course-1", lesson_kajabi_id: "2200968704", captured_at: NOW.toISOString() });
    expect(mod.documentsOf(data.kajabiQuizzes[0].raw_payload)).toEqual([jsonApiQuiz()]);

    expect(await mod.saveQuizCapture({} as never, capture(), new Date("2027-02-04T00:00:00.000Z"))).toBe("unchanged");
    expect(data.kajabiQuizzes[0].captured_at).toBe(NOW.toISOString());

    expect(await mod.saveQuizCapture({} as never, capture([jsonApiQuiz({ passing_grade: 70 })]), NOW)).toBe("updated");
    expect(await mod.saveQuizCapture({} as never, capture([jsonApiQuiz({ passing_grade: 90 })]), NOW, { dryRun: true })).toBe("updated");
    expect(mod.documentsOf(data.kajabiQuizzes[0].raw_payload)).toEqual([jsonApiQuiz({ passing_grade: 70 })]);

    // A row stored with the old whole-document hash is rewritten once, then it is unchanged.
    data.kajabiQuizzes[0].content_hash = "a".repeat(64);
    expect(await mod.saveQuizCapture({} as never, capture([jsonApiQuiz({ passing_grade: 70 })]), NOW)).toBe("updated");
    expect(await mod.saveQuizCapture({} as never, capture([jsonApiQuiz({ passing_grade: 70 })]), NOW)).toBe("unchanged");

    expect(await mod.retireQuizzesOfLesson({} as never, "2200968704", NOW, { dryRun: true })).toBe(0);
    expect(await mod.retireQuizzesOfLesson({} as never, "2200968704", NOW)).toBe(1);
    expect(data.kajabiQuizzes[0].deleted_at).toBe(NOW.toISOString());
    expect(await mod.saveQuizCapture({} as never, capture([jsonApiQuiz({ passing_grade: 70 })]), NOW)).toBe("created");
    vi.doUnmock("@/lib/data/kajabi-courses");
  });

  it("exports the writers the capture script uses", () => {
    expect(typeof saveQuizCapture).toBe("function");
    expect(typeof retireQuizzesOfLesson).toBe("function");
  });
});

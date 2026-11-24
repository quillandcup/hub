import { fetchAllRows } from "@/lib/supabase/paginate";
import { compareText, inChunks, must } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** How a lesson is a quiz: a `quizzes` row points at it (one per lesson). Settings only; title, text and status are the lesson's. */
export type QuizRecord = {
  id: string;
  lessonId: string;
  /** Percent of questions to answer fully right to pass; null = not graded (any submitted attempt completes the lesson). */
  passingPercent: number | null;
  /** Members see their score but not which answers were right. */
  hideAnswers: boolean;
  /** Counts edits to the questions (the audit log records the edit on the quiz through it). */
  revision: number;
  /** Kajabi's quiz id when the quiz was imported. */
  sourceKey: string | null;
};
export type QuizSettings = { passingPercent: number | null; hideAnswers: boolean };

export type QuizOptionRecord = { id: string; position: number; label: string; isCorrect: boolean; sourceKey: string | null };
/** A question with its options, correct answers included: for staff and the server's scoring only, never sent to a member before they submit. */
export type QuizQuestionRecord = {
  id: string;
  quizId: string;
  position: number;
  prompt: string;
  allowsMultiple: boolean;
  sourceKey: string | null;
  options: QuizOptionRecord[];
};
/** What the builder sends for one question; an option with an `id` keeps it (so past answers still point at it). */
export type QuizQuestionInput = { prompt: string; allowsMultiple: boolean; options: { id?: string; label: string; isCorrect: boolean }[] };

export type QuizAttemptRecord = {
  id: string;
  quizId: string;
  memberId: string;
  /** Scored questions, and how many were answered fully right. */
  questionCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  submittedAt: string;
};
export type QuizAttemptAnswerRecord = { attemptId: string; questionId: string; selectedOptionIds: string[]; isCorrect: boolean | null };
export type NewQuizAttempt = {
  quizId: string;
  memberId: string;
  questionCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  /** When it was submitted; now when omitted (for seeding and imports). */
  submittedAt?: string;
  answers: { questionId: string; selectedOptionIds: string[]; isCorrect: boolean | null }[];
};

/** A quiz as Kajabi has it, for the Silver step: every question and option carries Kajabi's key, so a re-import updates rows in place. */
export type ImportedQuiz = {
  /** Kajabi's quiz id. */
  sourceKey: string;
  passingPercent: number | null;
  hideAnswers: boolean;
  questions: { sourceKey: string; prompt: string; allowsMultiple: boolean; options: { sourceKey: string; label: string; isCorrect: boolean }[] }[];
};
/** What syncing one imported quiz did: skipped when the lesson isn't there or isn't Kajabi's. */
export type QuizSyncResult = { status: "synced" | "skipped"; questions: number; options: number; removedQuestions: number };

/** A refused write. `code` is the function's own error (`invalid_question`, `not_found`, `stale_order`, `not_editable`) or the database's (23505 unique, 42501 policy). */
export class QuizWriteError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "QuizWriteError";
  }
}
const writeError = (error: { message: string; code?: string }) => new QuizWriteError(error.message, error.code);

const ID_CHUNK = 200;

/**
 * Quizzes in courses (`quizzes`, `quiz_questions`, `quiz_options`, `quiz_attempts`, `quiz_attempt_answers`; docs/product/COURSES.md,
 * "Quizzes"). Two kinds of caller, told apart by the client:
 *  - **Staff** (the admin's own client, so the audit log names them): create and delete a quiz, change its settings, and
 *    save, delete and reorder questions, on the quizzes of Hub-owned lessons. A refused write throws `QuizWriteError`.
 *  - **The server** (service role, after its own access check): read the questions with their correct answers to score
 *    an attempt, and record the attempt. Members' own clients can read neither questions nor options (row-level security),
 *    so a correct answer can't reach a browser before it is submitted; they can read only their own attempts.
 * Reads that can grow (attempts of a quiz) paginate past 1000 rows in a stable order. Throws the database's message on an error.
 */
export interface QuizRepository {
  /** The quiz a lesson is, or null when the lesson is not a quiz (or the caller can't read it). */
  quizOfLesson(lessonId: string): Promise<QuizRecord | null>;
  /** The quiz of each of these lessons that is one, by lesson id (for outlines: which lessons are quizzes). */
  quizzesOfLessons(lessonIds: string[]): Promise<Map<string, QuizRecord>>;
  /** Makes the lesson a quiz lesson (no questions yet). Throws `QuizWriteError` if it already is one or the caller may not. */
  createQuiz(lessonId: string, settings?: Partial<QuizSettings>): Promise<QuizRecord>;
  updateSettings(quizId: string, settings: QuizSettings): Promise<void>;
  /** Takes the quiz off the lesson: its questions, options and every member's attempts go with it. */
  deleteQuiz(quizId: string): Promise<void>;

  /** The quiz's questions in order, each with its options in order and which are correct. Staff and the server only. */
  questionsOf(quizId: string): Promise<QuizQuestionRecord[]>;
  /** Saves one question whole (a new one when `questionId` is null) and returns its id. Throws `QuizWriteError` with `invalid_question` for a bad shape. */
  saveQuestion(quizId: string, questionId: string | null, input: QuizQuestionInput): Promise<string>;
  deleteQuestion(quizId: string, questionId: string): Promise<void>;
  /** Puts the questions in this order; the list must be exactly the current ones (`stale_order` otherwise). */
  reorderQuestions(quizId: string, questionIds: string[]): Promise<void>;

  /** Stores a scored attempt and its answers (service role: the server scores first). */
  recordAttempt(attempt: NewQuizAttempt): Promise<QuizAttemptRecord>;
  /** A member's attempts at a quiz, newest first. */
  attemptsOf(memberId: string, quizId: string): Promise<QuizAttemptRecord[]>;
  /** What was picked in one attempt, by question. */
  answersOf(attemptId: string): Promise<QuizAttemptAnswerRecord[]>;
  /** Every attempt at a quiz, newest first (paginated past 1000). */
  attemptsOfQuiz(quizId: string): Promise<QuizAttemptRecord[]>;
  /** Whether the member has a passing attempt at the quiz. */
  hasPassed(memberId: string, quizId: string): Promise<boolean>;
  /**
   * The Silver step for one Kajabi quiz (service role): makes the quiz of this Kajabi lesson match what was captured, in one
   * transaction, on Kajabi's keys, so a member's attempts keep pointing at the same rows when nothing changed. A lesson that
   * isn't there or isn't Kajabi's (a Hub lesson, or one taken over) is skipped and left alone.
   */
  syncImportedQuiz(lessonId: string, quiz: ImportedQuiz): Promise<QuizSyncResult>;
  /** Removes the imported quizzes (the ones with a Kajabi key) of these lessons that are not in `keepSourceKeys`; returns how many. A quiz made in the Hub is never touched. */
  removeImportedQuizzes(lessonIds: string[], keepSourceKeys: string[]): Promise<number>;
  /** Removes a member's attempts at a quiz, their answers with them (staff clearing their own test attempts); returns how many there were. */
  clearAttempts(memberId: string, quizId: string): Promise<number>;
  /** How many attempts members have made at the quiz of each of these lessons, by lesson id; a lesson with none (or no quiz) is absent. */
  attemptCountsOfLessons(lessonIds: string[]): Promise<Map<string, number>>;
}

type QuizRow = Row<"quizzes">;
const toQuiz = (row: QuizRow): QuizRecord => ({
  id: row.id,
  lessonId: row.lesson_id,
  passingPercent: row.passing_percent,
  hideAnswers: row.hide_answers,
  revision: row.revision,
  sourceKey: row.source_key,
});
const toAttempt = (row: Row<"quiz_attempts">): QuizAttemptRecord => ({
  id: row.id,
  quizId: row.quiz_id,
  memberId: row.member_id,
  questionCount: row.question_count,
  correctCount: row.correct_count,
  scorePercent: row.score_percent,
  passed: row.passed,
  submittedAt: row.submitted_at,
});
const newestFirst = (a: QuizAttemptRecord, b: QuizAttemptRecord) =>
  a.submittedAt === b.submittedAt ? compareText(b.id, a.id) : compareText(b.submittedAt, a.submittedAt);

export class SupabaseQuizRepository implements QuizRepository {
  constructor(private readonly db: Db) {}

  async quizOfLesson(lessonId: string) {
    const row = must(await this.db.from("quizzes").select("*").eq("lesson_id", lessonId).maybeSingle());
    return row ? toQuiz(row) : null;
  }

  async quizzesOfLessons(lessonIds: string[]) {
    const rows = await inChunks(lessonIds, ID_CHUNK, async (part) => must(await this.db.from("quizzes").select("*").in("lesson_id", part)) ?? []);
    return new Map(rows.map((r) => [r.lesson_id, toQuiz(r)]));
  }

  async createQuiz(lessonId: string, settings: Partial<QuizSettings> = {}) {
    const { data, error } = await this.db
      .from("quizzes")
      .insert({ lesson_id: lessonId, passing_percent: settings.passingPercent ?? null, hide_answers: settings.hideAnswers ?? false })
      .select("*")
      .single();
    if (error) throw writeError(error);
    return toQuiz(data);
  }

  async updateSettings(quizId: string, settings: QuizSettings) {
    const { data, error } = await this.db
      .from("quizzes")
      .update({ passing_percent: settings.passingPercent, hide_answers: settings.hideAnswers })
      .eq("id", quizId)
      .select("id");
    if (error) throw writeError(error);
    // Row-level security hides a quiz the caller may not edit: nothing was updated.
    if (!data?.length) throw new QuizWriteError("not_found", "not_found");
  }

  async deleteQuiz(quizId: string) {
    const { data, error } = await this.db.from("quizzes").delete().eq("id", quizId).select("id");
    if (error) throw writeError(error);
    if (!data?.length) throw new QuizWriteError("not_found", "not_found");
  }

  async questionsOf(quizId: string) {
    const questions = must(await this.db.from("quiz_questions").select("*").eq("quiz_id", quizId).order("position").order("id")) ?? [];
    const options = await inChunks(
      questions.map((q) => q.id),
      ID_CHUNK,
      async (part) => must(await this.db.from("quiz_options").select("*").in("question_id", part)) ?? [],
    );
    return questions.map((q) => ({
      id: q.id,
      quizId: q.quiz_id,
      position: q.position,
      prompt: q.prompt,
      allowsMultiple: q.allows_multiple,
      sourceKey: q.source_key,
      options: options
        .filter((o) => o.question_id === q.id)
        .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
        .map((o) => ({ id: o.id, position: o.position, label: o.label, isCorrect: o.is_correct, sourceKey: o.source_key })),
    }));
  }

  async saveQuestion(quizId: string, questionId: string | null, input: QuizQuestionInput) {
    const { data, error } = await this.db.rpc("save_quiz_question", {
      p_quiz_id: quizId,
      // The function treats null as "a new question"; the generated argument type doesn't allow it.
      p_question_id: questionId as string,
      p_prompt: input.prompt,
      p_allows_multiple: input.allowsMultiple,
      p_options: input.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label, is_correct: o.isCorrect })),
    });
    if (error) throw writeError({ message: error.message, code: error.message });
    return data;
  }

  async deleteQuestion(quizId: string, questionId: string) {
    const { error } = await this.db.rpc("delete_quiz_question", { p_quiz_id: quizId, p_question_id: questionId });
    if (error) throw writeError({ message: error.message, code: error.message });
  }

  async reorderQuestions(quizId: string, questionIds: string[]) {
    const { error } = await this.db.rpc("reorder_quiz_questions", { p_quiz_id: quizId, p_ids: questionIds });
    if (error) throw writeError({ message: error.message, code: error.message });
  }

  async recordAttempt(attempt: NewQuizAttempt) {
    const { data: row, error: attemptError } = await this.db
      .from("quiz_attempts")
      .insert({
        quiz_id: attempt.quizId,
        member_id: attempt.memberId,
        question_count: attempt.questionCount,
        correct_count: attempt.correctCount,
        score_percent: attempt.scorePercent,
        passed: attempt.passed,
        ...(attempt.submittedAt ? { submitted_at: attempt.submittedAt } : {}),
      })
      .select("*")
      .single();
    if (attemptError) throw new Error(attemptError.message);
    if (attempt.answers.length) {
      const { error } = await this.db
        .from("quiz_attempt_answers")
        .insert(attempt.answers.map((a) => ({ attempt_id: row.id, question_id: a.questionId, selected_option_ids: a.selectedOptionIds, is_correct: a.isCorrect })));
      if (error) {
        // Don't keep an attempt without its answers: a retry then records it whole.
        await this.db.from("quiz_attempts").delete().eq("id", row.id);
        throw new Error(error.message);
      }
    }
    return toAttempt(row);
  }

  async attemptsOf(memberId: string, quizId: string) {
    const rows = must(await this.db.from("quiz_attempts").select("*").eq("member_id", memberId).eq("quiz_id", quizId).order("submitted_at", { ascending: false }).order("id", { ascending: false })) ?? [];
    return rows.map(toAttempt);
  }

  async answersOf(attemptId: string) {
    const rows = must(await this.db.from("quiz_attempt_answers").select("*").eq("attempt_id", attemptId).order("question_id")) ?? [];
    return rows.map((r) => ({ attemptId: r.attempt_id, questionId: r.question_id, selectedOptionIds: r.selected_option_ids, isCorrect: r.is_correct }));
  }

  async attemptsOfQuiz(quizId: string) {
    const rows = await fetchAllRows((from, to) => this.db.from("quiz_attempts").select("*").eq("quiz_id", quizId).order("submitted_at", { ascending: false }).order("id", { ascending: false }).range(from, to));
    return rows.map(toAttempt);
  }

  async hasPassed(memberId: string, quizId: string) {
    const { count, error } = await this.db.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("quiz_id", quizId).eq("passed", true);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async syncImportedQuiz(lessonId: string, quiz: ImportedQuiz) {
    const { data, error } = await this.db.rpc("sync_imported_quiz", {
      p_lesson_id: lessonId,
      p_quiz: {
        source_key: quiz.sourceKey,
        passing_percent: quiz.passingPercent,
        hide_answers: quiz.hideAnswers,
        questions: quiz.questions.map((q) => ({
          source_key: q.sourceKey,
          prompt: q.prompt,
          allows_multiple: q.allowsMultiple,
          options: q.options.map((o) => ({ source_key: o.sourceKey, label: o.label, is_correct: o.isCorrect })),
        })),
      },
    });
    if (error) throw new Error(error.message);
    const result = data as { status: "synced" | "skipped"; questions: number; options: number; removed_questions: number };
    return { status: result.status, questions: result.questions, options: result.options, removedQuestions: result.removed_questions };
  }

  async removeImportedQuizzes(lessonIds: string[], keepSourceKeys: string[]) {
    const keep = new Set(keepSourceKeys);
    // Which quizzes are imported ones is read first (a quiz made in the Hub has no Kajabi key), then removed by id.
    const found = await inChunks(lessonIds, ID_CHUNK, async (part) => must(await this.db.from("quizzes").select("id, source_key").in("lesson_id", part).not("source_key", "is", null)) ?? []);
    const gone = found.filter((q) => !keep.has(q.source_key as string)).map((q) => q.id);
    for (let i = 0; i < gone.length; i += ID_CHUNK) {
      const { error } = await this.db.from("quizzes").delete().in("id", gone.slice(i, i + ID_CHUNK));
      if (error) throw new Error(error.message);
    }
    return gone.length;
  }

  async clearAttempts(memberId: string, quizId: string) {
    const { data, error } = await this.db.from("quiz_attempts").delete().eq("member_id", memberId).eq("quiz_id", quizId).select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }

  async attemptCountsOfLessons(lessonIds: string[]) {
    const quizzes = await this.quizzesOfLessons(lessonIds);
    const byQuiz = new Map([...quizzes.values()].map((q) => [q.id, q.lessonId]));
    const counts = new Map<string, number>();
    // One head-count query per quiz: a lesson list holds few quizzes, and a count never pages.
    await Promise.all(
      [...byQuiz.keys()].map(async (quizId) => {
        const { count, error } = await this.db.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("quiz_id", quizId);
        if (error) throw new Error(error.message);
        if (count) counts.set(byQuiz.get(quizId)!, count);
      }),
    );
    return counts;
  }
}

/** In-memory twin over an `InMemoryDataset`; it enforces the same rules as the database and its functions. */
export class InMemoryQuizRepository implements QuizRepository {
  constructor(private readonly data: InMemoryDataset) {}

  /** A fresh id of the table's shape (`prefix_` and twelve characters), never reused after a delete. */
  private nextId(prefix: string) {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    return `${prefix}_${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
  }

  private quiz(quizId: string) {
    return this.data.quizzes.find((q) => q.id === quizId);
  }

  async quizOfLesson(lessonId: string) {
    const row = this.data.quizzes.find((q) => q.lesson_id === lessonId);
    return row ? toQuiz(row) : null;
  }

  async quizzesOfLessons(lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return new Map(this.data.quizzes.filter((q) => wanted.has(q.lesson_id)).map((q) => [q.lesson_id, toQuiz(q)]));
  }

  async createQuiz(lessonId: string, settings: Partial<QuizSettings> = {}) {
    if (this.data.quizzes.some((q) => q.lesson_id === lessonId)) throw new QuizWriteError('duplicate key value violates unique constraint "quizzes_lesson_id_key"', "23505");
    if (settings.passingPercent != null && (settings.passingPercent < 1 || settings.passingPercent > 100)) throw new QuizWriteError('violates check constraint "quizzes_passing_percent_check"', "23514");
    const now = new Date().toISOString();
    const row: QuizRow = {
      id: this.nextId("quiz"),
      lesson_id: lessonId,
      passing_percent: settings.passingPercent ?? null,
      hide_answers: settings.hideAnswers ?? false,
      revision: 0,
      source_key: null,
      created_at: now,
      updated_at: now,
    };
    this.data.quizzes.push(row);
    return toQuiz(row);
  }

  async updateSettings(quizId: string, settings: QuizSettings) {
    const quiz = this.quiz(quizId);
    if (!quiz) throw new QuizWriteError("not_found", "not_found");
    if (settings.passingPercent != null && (settings.passingPercent < 1 || settings.passingPercent > 100)) throw new QuizWriteError('violates check constraint "quizzes_passing_percent_check"', "23514");
    quiz.passing_percent = settings.passingPercent;
    quiz.hide_answers = settings.hideAnswers;
  }

  async deleteQuiz(quizId: string) {
    if (!this.quiz(quizId)) throw new QuizWriteError("not_found", "not_found");
    this.data.quizzes = this.data.quizzes.filter((q) => q.id !== quizId);
    const questionIds = new Set(this.data.quizQuestions.filter((q) => q.quiz_id === quizId).map((q) => q.id));
    this.data.quizQuestions = this.data.quizQuestions.filter((q) => q.quiz_id !== quizId);
    this.data.quizOptions = this.data.quizOptions.filter((o) => !questionIds.has(o.question_id));
    const attemptIds = new Set(this.data.quizAttempts.filter((a) => a.quiz_id === quizId).map((a) => a.id));
    this.data.quizAttempts = this.data.quizAttempts.filter((a) => a.quiz_id !== quizId);
    this.data.quizAttemptAnswers = this.data.quizAttemptAnswers.filter((a) => !attemptIds.has(a.attempt_id));
  }

  async questionsOf(quizId: string) {
    return this.data.quizQuestions
      .filter((q) => q.quiz_id === quizId)
      .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
      .map((q) => ({
        id: q.id,
        quizId: q.quiz_id,
        position: q.position,
        prompt: q.prompt,
        allowsMultiple: q.allows_multiple,
        sourceKey: q.source_key,
        options: this.data.quizOptions
          .filter((o) => o.question_id === q.id)
          .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
          .map((o) => ({ id: o.id, position: o.position, label: o.label, isCorrect: o.is_correct, sourceKey: o.source_key })),
      }));
  }

  async saveQuestion(quizId: string, questionId: string | null, input: QuizQuestionInput) {
    const prompt = input.prompt.trim();
    const invalid = () => new QuizWriteError("invalid_question", "invalid_question");
    const correct = input.options.filter((o) => o.isCorrect).length;
    if (!prompt || prompt.length > 1000) throw invalid();
    if (input.options.length < 2 || input.options.length > 12) throw invalid();
    if (input.options.some((o) => !o.label.trim() || o.label.trim().length > 500)) throw invalid();
    if (correct < 1 || (!input.allowsMultiple && correct !== 1)) throw invalid();
    const quiz = this.quiz(quizId);
    if (!quiz) throw new QuizWriteError("not_found", "not_found");

    let question = questionId === null ? undefined : this.data.quizQuestions.find((q) => q.id === questionId && q.quiz_id === quizId);
    if (questionId !== null && !question) throw new QuizWriteError("not_found", "not_found");
    const existing = question ? this.data.quizOptions.filter((o) => o.question_id === question!.id) : [];
    // An option id must be one of this question's own (checked before anything changes, like the function's rollback).
    if (input.options.some((o) => o.id && !existing.some((e) => e.id === o.id))) throw invalid();

    const now = new Date().toISOString();
    if (!question) {
      question = {
        id: this.nextId("qques"),
        quiz_id: quizId,
        position: Math.max(0, ...this.data.quizQuestions.filter((q) => q.quiz_id === quizId).map((q) => q.position)) + 1,
        prompt,
        allows_multiple: input.allowsMultiple,
        source_key: null,
        created_at: now,
        updated_at: now,
      };
      this.data.quizQuestions.push(question);
    } else {
      question.prompt = prompt;
      question.allows_multiple = input.allowsMultiple;
    }
    const kept = new Set(input.options.map((o) => o.id).filter((id): id is string => !!id));
    this.data.quizOptions = this.data.quizOptions.filter((o) => o.question_id !== question!.id || kept.has(o.id));
    input.options.forEach((o, i) => {
      const found = o.id ? this.data.quizOptions.find((e) => e.id === o.id) : undefined;
      if (found) {
        found.position = i + 1;
        found.label = o.label.trim();
        found.is_correct = o.isCorrect;
      } else {
        this.data.quizOptions.push({
          id: this.nextId("qopt"),
          question_id: question!.id,
          position: i + 1,
          label: o.label.trim(),
          is_correct: o.isCorrect,
          source_key: null,
          created_at: now,
          updated_at: now,
        });
      }
    });
    quiz.revision += 1;
    return question.id;
  }

  async deleteQuestion(quizId: string, questionId: string) {
    const question = this.data.quizQuestions.find((q) => q.id === questionId && q.quiz_id === quizId);
    if (!question) throw new QuizWriteError("not_found", "not_found");
    this.data.quizQuestions = this.data.quizQuestions.filter((q) => q.id !== questionId);
    this.data.quizOptions = this.data.quizOptions.filter((o) => o.question_id !== questionId);
    this.data.quizAttemptAnswers = this.data.quizAttemptAnswers.filter((a) => a.question_id !== questionId);
    this.data.quizQuestions
      .filter((q) => q.quiz_id === quizId)
      .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
      .forEach((q, i) => (q.position = i + 1));
    this.quiz(quizId)!.revision += 1;
  }

  async reorderQuestions(quizId: string, questionIds: string[]) {
    const quiz = this.quiz(quizId);
    if (!quiz) throw new QuizWriteError("not_found", "not_found");
    const current = this.data.quizQuestions.filter((q) => q.quiz_id === quizId);
    const stale = () => new QuizWriteError("stale_order", "stale_order");
    if (new Set(questionIds).size !== questionIds.length) throw stale();
    if (questionIds.length !== current.length || !current.every((q) => questionIds.includes(q.id))) throw stale();
    const ordered = [...current].sort((a, b) => a.position - b.position || compareText(a.id, b.id)).map((q) => q.id);
    if (ordered.every((id, i) => id === questionIds[i])) return;
    questionIds.forEach((id, i) => (current.find((q) => q.id === id)!.position = i + 1));
    quiz.revision += 1;
  }

  async recordAttempt(attempt: NewQuizAttempt) {
    if (!this.quiz(attempt.quizId)) throw new Error("insert or update on table \"quiz_attempts\" violates foreign key constraint");
    const row: Row<"quiz_attempts"> = {
      id: this.nextId("qatt"),
      quiz_id: attempt.quizId,
      member_id: attempt.memberId,
      question_count: attempt.questionCount,
      correct_count: attempt.correctCount,
      score_percent: attempt.scorePercent,
      passed: attempt.passed,
      submitted_at: attempt.submittedAt ?? new Date().toISOString(),
    };
    this.data.quizAttempts.push(row);
    for (const a of attempt.answers) {
      this.data.quizAttemptAnswers.push({ attempt_id: row.id, question_id: a.questionId, selected_option_ids: a.selectedOptionIds, is_correct: a.isCorrect });
    }
    return toAttempt(row);
  }

  async attemptsOf(memberId: string, quizId: string) {
    return this.data.quizAttempts.filter((a) => a.member_id === memberId && a.quiz_id === quizId).map(toAttempt).sort(newestFirst);
  }

  async answersOf(attemptId: string) {
    return this.data.quizAttemptAnswers
      .filter((a) => a.attempt_id === attemptId)
      .sort((a, b) => compareText(a.question_id, b.question_id))
      .map((a) => ({ attemptId: a.attempt_id, questionId: a.question_id, selectedOptionIds: a.selected_option_ids, isCorrect: a.is_correct }));
  }

  async attemptsOfQuiz(quizId: string) {
    return this.data.quizAttempts.filter((a) => a.quiz_id === quizId).map(toAttempt).sort(newestFirst);
  }

  async hasPassed(memberId: string, quizId: string) {
    return this.data.quizAttempts.some((a) => a.member_id === memberId && a.quiz_id === quizId && a.passed);
  }

  async syncImportedQuiz(lessonId: string, imported: ImportedQuiz) {
    const lesson = this.data.courseLessons.find((l) => l.id === lessonId);
    if (!lesson || lesson.source !== "kajabi") return { status: "skipped" as const, questions: 0, options: 0, removedQuestions: 0 };
    const now = new Date().toISOString();
    let quiz = this.data.quizzes.find((q) => q.lesson_id === lessonId);
    if (!quiz) {
      quiz = { id: this.nextId("quiz"), lesson_id: lessonId, passing_percent: null, hide_answers: false, revision: 0, source_key: null, created_at: now, updated_at: now };
      this.data.quizzes.push(quiz);
    }
    quiz.passing_percent = imported.passingPercent;
    quiz.hide_answers = imported.hideAnswers;
    quiz.source_key = imported.sourceKey;

    let options = 0;
    const questionKeys = new Set(imported.questions.map((q) => q.sourceKey));
    imported.questions.forEach((q, i) => {
      let row = this.data.quizQuestions.find((x) => x.quiz_id === quiz.id && x.source_key === q.sourceKey);
      if (!row) {
        row = { id: this.nextId("qques"), quiz_id: quiz.id, position: i + 1, prompt: q.prompt, allows_multiple: q.allowsMultiple, source_key: q.sourceKey, created_at: now, updated_at: now };
        this.data.quizQuestions.push(row);
      }
      row.position = i + 1;
      row.prompt = q.prompt.trim();
      row.allows_multiple = q.allowsMultiple;
      const optionKeys = new Set(q.options.map((o) => o.sourceKey));
      q.options.forEach((o, j) => {
        let opt = this.data.quizOptions.find((x) => x.question_id === row!.id && x.source_key === o.sourceKey);
        if (!opt) {
          opt = { id: this.nextId("qopt"), question_id: row!.id, position: j + 1, label: o.label, is_correct: o.isCorrect, source_key: o.sourceKey, created_at: now, updated_at: now };
          this.data.quizOptions.push(opt);
        }
        opt.position = j + 1;
        opt.label = o.label.trim();
        opt.is_correct = o.isCorrect;
        options++;
      });
      this.data.quizOptions = this.data.quizOptions.filter((x) => x.question_id !== row!.id || x.source_key === null || optionKeys.has(x.source_key));
    });
    const dropped = this.data.quizQuestions.filter((q) => q.quiz_id === quiz.id && q.source_key !== null && !questionKeys.has(q.source_key));
    const droppedIds = new Set(dropped.map((q) => q.id));
    this.data.quizQuestions = this.data.quizQuestions.filter((q) => !droppedIds.has(q.id));
    this.data.quizOptions = this.data.quizOptions.filter((o) => !droppedIds.has(o.question_id));
    this.data.quizAttemptAnswers = this.data.quizAttemptAnswers.filter((a) => !droppedIds.has(a.question_id));
    return { status: "synced" as const, questions: imported.questions.length, options, removedQuestions: dropped.length };
  }

  async removeImportedQuizzes(lessonIds: string[], keepSourceKeys: string[]) {
    const keep = new Set(keepSourceKeys);
    const gone = this.data.quizzes.filter((q) => lessonIds.includes(q.lesson_id) && q.source_key !== null && !keep.has(q.source_key));
    for (const q of gone) await this.deleteQuiz(q.id);
    return gone.length;
  }

  async clearAttempts(memberId: string, quizId: string) {
    const gone = new Set(this.data.quizAttempts.filter((a) => a.member_id === memberId && a.quiz_id === quizId).map((a) => a.id));
    this.data.quizAttempts = this.data.quizAttempts.filter((a) => !gone.has(a.id));
    this.data.quizAttemptAnswers = this.data.quizAttemptAnswers.filter((a) => !gone.has(a.attempt_id));
    return gone.size;
  }

  async attemptCountsOfLessons(lessonIds: string[]) {
    const counts = new Map<string, number>();
    for (const quiz of this.data.quizzes.filter((q) => lessonIds.includes(q.lesson_id))) {
      const count = this.data.quizAttempts.filter((a) => a.quiz_id === quiz.id).length;
      if (count) counts.set(quiz.lesson_id, count);
    }
    return counts;
  }
}

/**
 * Kajabi quizzes (docs/product/COURSES.md, "Quizzes", "Importing quizzes from Kajabi"). A quiz is a lesson of a course whose
 * editor page (`/admin/posts/{id}/edit`) redirects to the quiz editor (`/admin/quizzes/{quizId}/edit`). The capture
 * (`scripts/kajabi-course-content.ts`) opens that editor in the logged-in browser and keeps the JSON documents it loads in
 * Bronze (`bronze.kajabi_quizzes.raw_payload`); this module reads questions, answers, the marked-right ones and the settings
 * out of those documents (the Silver step), so a better reading is a reprocess, not a new capture.
 *
 * UNVERIFIED AGAINST THE LIVE ADMIN: no one could log in to Kajabi when this was written, so the reading is tolerant by
 * design. It accepts a JSON:API document (`data` + `included`, relationships resolved) or plain nested JSON, finds the list
 * of questions wherever it is (an array of objects with a prompt-like text and a list of answer-like objects), reads which
 * answer is right from a flag on the answer or an id on the question, and never guesses a correct answer. When it finds no
 * questions, the capture says so and prints the documents' field names and types (never values) with `describeJson`, so
 * the reading can be fixed from facts: `npm run courses:content -- --probe <the quiz editor address>` shows the same.
 *
 * Relative imports only: scripts/kajabi-course-content.ts runs this outside Next.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asJson } from "../data/json";
import { SupabaseKajabiCourseRepository } from "../data/kajabi-courses";
import type { ImportedQuiz } from "../data/quizzes";
import type { Db } from "../data/db";

const coursesOf = (supabase: SupabaseClient) => new SupabaseKajabiCourseRepository(supabase as Db);

/** The quiz id in the address a lesson's editor redirects to (`/admin/quizzes/{id}/edit`), or null. */
export function quizIdOfRedirect(location: string | null | undefined): string | null {
  if (!location) return null;
  try {
    return /^\/admin\/quizzes\/([^/]+)(\/|$)/.exec(new URL(location, "https://example.invalid").pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Every JSON document embedded in a page (`<script id="kjb-redux-store-data">`), parsed; a block that isn't JSON is skipped. */
export function embeddedDocuments(html: string): unknown[] {
  const docs: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\bid="kjb-redux-store-data"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      docs.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }
  return docs;
}

/** What the capture keeps in Bronze for one quiz: the documents the editor loaded. */
export interface QuizCapture {
  quizKajabiId: string;
  courseKajabiId: string;
  lessonKajabiId: string;
  documents: unknown[];
}

/** The same documents hash the same: object keys are sorted, so a reordered response is not a change. */
export function quizContentHash(documents: unknown[]): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical(documents))).digest("hex");
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the documents
// ---------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** A key without case, underscores and dashes, so `is_correct`, `isCorrect` and `IsCorrect` are one name. */
const norm = (key: string) => key.toLowerCase().replace(/[_-]/g, "");
const PROMPT_KEYS = ["question", "prompt", "body", "text", "title", "name", "content", "label"].map(norm);
const OPTION_LIST_KEYS = ["answers", "options", "choices", "responses", "answeroptions", "quizanswers", "possibleanswers", "quizoptions", "quizresponses"].map(norm);
const OPTION_TEXT_KEYS = ["answer", "text", "body", "title", "label", "name", "content", "value", "description"].map(norm);
const CORRECT_KEYS = ["correct", "iscorrect", "correctanswer", "right", "isright", "isanswer"].map(norm);
const CORRECT_ID_KEYS = ["correctanswerid", "correctanswerids", "correctoptionid", "correctoptionids", "correctchoiceid", "correctchoiceids"].map(norm);
const QUESTION_REF_KEYS = ["questionid", "quizquestionid"].map(norm);
const MULTIPLE_KEYS = ["allowmultiple", "allowsmultiple", "multipleanswers", "multiselect", "multipleselection", "allowmultipleanswers"].map(norm);
const ORDER_KEYS = ["position", "order", "sort", "sortorder", "index"].map(norm);
const PASSING_KEYS = ["passinggrade", "passingscore", "passingpercentage", "passpercentage", "passmark", "minimumscore", "minscore", "passingpercent", "requiredscore"].map(norm);
const PASSING_ON_KEYS = ["passinggradeenabled", "setpassinggrade", "haspassinggrade", "passingenabled", "gradingenabled", "graded"].map(norm);
const TYPE_KEYS = ["questiontype", "type", "kind", "format"].map(norm);
const MANUAL_FLAG_KEYS = ["gradedmanually", "manuallygraded", "manualgrading", "manual"].map(norm);
/** Question types Kajabi grades by hand (short answer, file upload): the Hub builds only the auto-graded kinds. */
const MANUAL_TYPE = /short|free.?text|essay|file|upload|manual|open.?ended/i;
const HIDE_KEYS = ["hideanswers", "hidecorrectanswers", "hideanswersonresults", "hideanswersonresultspage", "hideresultsanswers", "hideanswersonresult"].map(norm);

/** The value of the first of these keys (in the order given) that the object has. */
const valueOf = (o: Obj, wanted: string[]): unknown => {
  for (const name of wanted) {
    const entry = Object.entries(o).find(([k]) => norm(k) === name);
    if (entry) return entry[1];
  }
  return undefined;
};

/** The first of these keys (in the order given) whose value reads as some text. */
const firstText = (o: Obj, keys: string[]): string => {
  for (const name of keys) {
    const entry = Object.entries(o).find(([k]) => norm(k) === name);
    const text = entry ? plainText(entry[1]) : "";
    if (text) return text;
  }
  return "";
};

/** Plain text of a prompt or answer: tags dropped, the common entities decoded, whitespace collapsed. */
export function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/<\s*br\s*\/?>/gi, " ").replace(/<\/(p|div|li)>/gi, " ");
  // Repeat until nothing changes, so a tag nested in another can't leave one behind after a single pass.
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  }
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A JSON:API document with its relationships resolved into plain nested objects (depth limited, so a cycle can't loop). */
function resolveJsonApi(doc: unknown): unknown {
  if (!isObj(doc) || !("data" in doc)) return doc;
  const included = new Map<string, Obj>();
  for (const item of Array.isArray(doc.included) ? doc.included : []) if (isObj(item) && keyText(item.id) !== null) included.set(`${keyText(item.type)}:${keyText(item.id)}`, item);
  const build = (resource: unknown, depth: number): unknown => {
    if (!isObj(resource)) return resource;
    const full = included.get(`${keyText(resource.type)}:${keyText(resource.id)}`) ?? resource;
    const out: Obj = { id: full.id, type: full.type, ...(isObj(full.attributes) ? full.attributes : {}) };
    if (depth <= 0 || !isObj(full.relationships)) return out;
    for (const [name, rel] of Object.entries(full.relationships)) {
      const data = isObj(rel) ? rel.data : undefined;
      if (Array.isArray(data)) out[name] = data.map((d) => build(d, depth - 1));
      else if (isObj(data)) out[name] = build(data, depth - 1);
    }
    return out;
  };
  const root = doc.data;
  return Array.isArray(root) ? root.map((r) => build(r, 4)) : build(root, 4);
}

/** Every array of objects in the document, and every object whose values are all objects (a store keyed by id), as lists to look through. */
function listsIn(node: unknown, out: Obj[][] = [], depth = 0): Obj[][] {
  if (depth > 12 || node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    const objects = node.filter(isObj);
    if (objects.length > 0) out.push(objects);
    for (const child of node) listsIn(child, out, depth + 1);
    return out;
  }
  const values = Object.values(node);
  if (values.length > 0 && values.every(isObj)) out.push(values as Obj[]);
  for (const child of values) listsIn(child, out, depth + 1);
  return out;
}

const optionTextOf = (o: Obj): string => firstText(o, OPTION_TEXT_KEYS);
/** An id or key as text; anything that isn't a string or a number is no id (an object can't even be turned into text safely). */
const keyText = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);
const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const asKey = (v: unknown, fallback: string): string => keyText(v) ?? fallback;

interface RawOption {
  id: string;
  label: string;
  isCorrect: boolean | null;
}
interface RawQuestion {
  id: string;
  prompt: string;
  options: RawOption[];
  order: number | null;
  allowsMultiple: boolean;
  correctIds: string[];
}

/** One option from an object, or null when it has no text. `isCorrect` is null when the object carries no flag at all. */
function optionOf(o: Obj, index: number): RawOption | null {
  const label = optionTextOf(o);
  if (!label) return null;
  const flag = valueOf(o, CORRECT_KEYS);
  return { id: asKey(o.id, `a${index + 1}`), label, isCorrect: flag === undefined ? null : truthy(flag) };
}

function questionOf(o: Obj, index: number, referenced: Map<string, Obj[]>): RawQuestion | null {
  const prompt = firstText(o, PROMPT_KEYS);
  if (!prompt) return null;
  let options: RawOption[] = [];
  const list = Object.entries(o).find(([k, v]) => OPTION_LIST_KEYS.includes(norm(k)) && Array.isArray(v));
  if (list) options = (list[1] as unknown[]).filter(isObj).map(optionOf).filter((x): x is RawOption => x !== null);
  // A store that keeps answers apart from questions: they point at their question.
  if (options.length === 0 && keyText(o.id) !== null) options = (referenced.get(keyText(o.id)!) ?? []).map(optionOf).filter((x): x is RawOption => x !== null);
  if (options.length < 2) return null;
  const order = valueOf(o, ORDER_KEYS);
  const correctRaw = valueOf(o, CORRECT_ID_KEYS);
  return {
    id: asKey(o.id, `q${index + 1}`),
    prompt,
    options,
    order: typeof order === "number" ? order : null,
    allowsMultiple: truthy(valueOf(o, MULTIPLE_KEYS)),
    correctIds: (Array.isArray(correctRaw) ? correctRaw : [correctRaw]).map(keyText).filter((id): id is string => id !== null),
  };
}

/** The questions found, in order. The list with the most questions wins; a question seen in two places counts once. */
function findQuestions(views: unknown[]): RawQuestion[] {
  const all = views.flatMap((v) => listsIn(v));
  // Answers that sit apart from their questions, grouped by the question they name.
  const referenced = new Map<string, Obj[]>();
  for (const list of all) {
    for (const item of list) {
      const ref = valueOf(item, QUESTION_REF_KEYS);
      const refKey = keyText(ref);
      if (refKey !== null && optionTextOf(item)) referenced.set(refKey, [...(referenced.get(refKey) ?? []), item]);
    }
  }
  let best: RawQuestion[] = [];
  for (const list of all) {
    const questions = list.map((o, i) => questionOf(o, i, referenced)).filter((q): q is RawQuestion => q !== null);
    if (questions.length > best.length) best = questions;
  }
  const seen = new Set<string>();
  const unique = best.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
  // Their own order when they carry one, otherwise the order they were listed in.
  return unique.every((q) => q.order !== null) ? [...unique].sort((a, b) => a.order! - b.order!) : unique;
}

/** The first value found for any of these keys, anywhere in the documents (depth first, so the quiz's own settings come before a question's). */
function findSetting(views: unknown[], keys: string[], accept: (v: unknown) => boolean): unknown {
  const visit = (node: unknown, depth: number): unknown => {
    if (depth > 12 || node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    for (const [key, value] of Object.entries(node)) if (keys.includes(norm(key)) && accept(value)) return value;
    for (const value of Object.values(node)) {
      const found = visit(value, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const view of views) {
    const found = visit(view, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** How many questions are graded by hand in Kajabi (short answer, file upload), counted once each. Such a quiz is not imported. */
function countManualQuestions(views: unknown[]): number {
  const seen = new Set<string>();
  for (const list of views.flatMap((v) => listsIn(v))) {
    list.forEach((o, i) => {
      if (!firstText(o, PROMPT_KEYS)) return;
      const type = valueOf(o, TYPE_KEYS);
      const flagged = truthy(valueOf(o, MANUAL_FLAG_KEYS));
      if (flagged || (typeof type === "string" && MANUAL_TYPE.test(type) && !/multiple|checkbox|choice/i.test(type))) seen.add(asKey(o.id, `${firstText(o, PROMPT_KEYS)}#${i}`));
    });
  }
  return seen.size;
}

export interface ParsedQuiz {
  /** Questions Kajabi grades by hand (short answer, file upload); when there are any the quiz is skipped, not imported. */
  manualQuestions: number;
  /** Whole percent 1 to 100, or null for a quiz that isn't graded. */
  passingPercent: number | null;
  hideAnswers: boolean;
  questions: { id: string; prompt: string; allowsMultiple: boolean; options: { id: string; label: string; isCorrect: boolean }[] }[];
  /** What was left out or guessed, in plain words (never a question's text). */
  warnings: string[];
}

/** Reads a quiz out of the documents the quiz editor loaded; null when no question with answers is in them. */
export function parseKajabiQuiz(documents: unknown[]): ParsedQuiz | null {
  const views = documents.flatMap((d) => {
    const resolved = resolveJsonApi(d);
    return resolved === d ? [d] : [resolved, d];
  });
  const found = findQuestions(views);
  const manualQuestions = countManualQuestions(views);
  if (found.length === 0 && manualQuestions === 0) return null;
  const warnings: string[] = [];

  const questions = found.map((q) => {
    const flagged = q.options.some((o) => o.isCorrect !== null);
    const options = q.options.map((o) => ({
      id: o.id,
      label: o.label,
      // The question names its right answers by id, or each answer carries a flag; never both guessed, never defaulted.
      isCorrect: q.correctIds.length > 0 ? q.correctIds.includes(o.id) : o.isCorrect === true,
    }));
    if (!flagged && q.correctIds.length === 0) warnings.push("a question has no right answer marked in what was captured, so it is not scored");
    return { id: q.id, prompt: q.prompt, allowsMultiple: q.allowsMultiple || options.filter((o) => o.isCorrect).length > 1, options };
  });

  const passingRaw = findSetting(views, PASSING_KEYS, (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))));
  const passingOn = findSetting(views, PASSING_ON_KEYS, (v) => typeof v === "boolean");
  let passingPercent: number | null = null;
  if (passingRaw !== undefined && passingOn !== false) {
    const n = Number(passingRaw);
    // A fraction (0.7) is read as a percent; 0 means no grade.
    const percent = n > 0 && n < 1 ? Math.round(n * 100) : Math.round(n);
    if (percent >= 1 && percent <= 100) passingPercent = percent;
    else if (percent !== 0) warnings.push("the passing grade was out of range, so the quiz is not graded");
  }
  const hide = findSetting(views, HIDE_KEYS, (v) => typeof v === "boolean" || v === 0 || v === 1);
  return { manualQuestions, passingPercent, hideAnswers: hide === true || hide === 1, questions, warnings };
}

/**
 * The quiz as the Silver step stores it, with what the database refuses already left out: a question needs text and two to twelve
 * answers with text (it is dropped, and said so, otherwise), and an answer's text is cut at the column's limit.
 */
export function importedQuizOf(quizKajabiId: string, parsed: ParsedQuiz): { quiz: ImportedQuiz; warnings: string[] } {
  const warnings = [...parsed.warnings];
  const questions: ImportedQuiz["questions"] = [];
  for (const q of parsed.questions) {
    if (q.options.length < 2 || q.options.length > 12) {
      warnings.push(`a question with ${q.options.length} answers was left out (a question has two to twelve)`);
      continue;
    }
    const optionKeys = new Set<string>();
    const options = q.options
      .filter((o) => (optionKeys.has(o.id) ? false : (optionKeys.add(o.id), true)))
      .map((o) => ({ sourceKey: o.id, label: o.label.slice(0, 500), isCorrect: o.isCorrect }));
    const right = options.filter((o) => o.isCorrect).length;
    questions.push({ sourceKey: q.id, prompt: q.prompt.slice(0, 1000), allowsMultiple: q.allowsMultiple || right > 1, options });
  }
  return { quiz: { sourceKey: quizKajabiId, passingPercent: parsed.passingPercent, hideAnswers: parsed.hideAnswers, questions }, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------
// Saving to Bronze
// ---------------------------------------------------------------------------------------------------------------------

export type QuizSaveOutcome = "created" | "updated" | "unchanged";

/** Writes a captured quiz to Bronze; a quiz whose documents haven't changed writes nothing. */
export async function saveQuizCapture(supabase: SupabaseClient, capture: QuizCapture, now: Date, { dryRun = false }: { dryRun?: boolean } = {}): Promise<QuizSaveOutcome> {
  const repo = coursesOf(supabase);
  const hash = quizContentHash(capture.documents);
  const existing = await repo.quizContentHash(capture.quizKajabiId);
  if (existing === hash) return "unchanged";
  if (!dryRun) {
    await repo.saveQuiz({
      kajabi_id: capture.quizKajabiId,
      course_kajabi_id: capture.courseKajabiId,
      lesson_kajabi_id: capture.lessonKajabiId,
      raw_payload: asJson({ documents: capture.documents }),
      content_hash: hash,
      captured_at: now.toISOString(),
    });
  }
  return existing === null ? "created" : "updated";
}

/** A lesson that was a quiz and is a plain lesson now: its Bronze quiz is retired (soft-deleted). Returns how many. */
export async function retireQuizzesOfLesson(supabase: SupabaseClient, lessonKajabiId: string, now: Date, { dryRun = false }: { dryRun?: boolean } = {}): Promise<number> {
  if (dryRun) return 0;
  return coursesOf(supabase).softDeleteQuizzesOfLesson(lessonKajabiId, now.toISOString());
}

/** The Bronze documents of a stored quiz, or an empty list when the payload isn't the shape the capture writes. */
export function documentsOf(rawPayload: unknown): unknown[] {
  return isObj(rawPayload) && Array.isArray(rawPayload.documents) ? rawPayload.documents : [];
}

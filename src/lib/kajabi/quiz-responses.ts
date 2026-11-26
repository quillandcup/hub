/**
 * Members' past quiz responses, read off Kajabi's quiz Results tab (docs/product/COURSES.md, "Importing past quiz responses").
 * The capture (`scripts/kajabi-course-content.ts --responses`) opens each quiz's results page in the logged-in browser, opens each
 * submission's grading view, and keeps the JSON documents they load; this module reads them: the list of submissions, and one
 * submission's responder (an email, never a name), date and answers, and it saves what it read to Bronze
 * (`bronze.kajabi_quiz_responses`) and copies uploaded files into storage.
 *
 * UNVERIFIED AGAINST THE LIVE ADMIN: no agent can log in to Kajabi, and what was seen of the screen (a row per submission with
 * name, email and date; a grading view with each question and the member's answer) is not its JSON. So, like `parseKajabiQuiz`,
 * the reading is tolerant: JSON:API or plain nested JSON; a submission is an object with an email; an answer is an object that names
 * its question and carries a text, picked answers or a file. It never guesses a match: what it can't read it counts, and prints
 * field names and types (never values), so the reading can be fixed from facts.
 *
 * Nothing here logs or returns a name, an email, an answer or a file name for display: the summaries are counts. Relative
 * imports only: the script that calls this runs outside Next.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asJson } from "../data/json";
import { SupabaseKajabiCourseRepository } from "../data/kajabi-courses";
import type { Db } from "../data/db";
import { isObj, keyText, listsIn, norm, plainText, resolveJsonApi, valueOf } from "./quiz-capture";
import { ORG_TIMEZONE } from "../config";
import { parseKajabiInstant } from "./progress-capture";

type Obj = Record<string, unknown>;

/** Where Bronze keeps the copy of a file until its responder is a member: never inside a member's own folder. */
export const IMPORT_FILE_PREFIX = "kajabi-import";

export interface ParsedFile {
  name: string;
  bytes: number | null;
  sourceUrl: string | null;
}

export interface ParsedAnswer {
  questionKey: string;
  /** The question as it was worded in the submission (null when the submission doesn't carry it). */
  prompt: string | null;
  /** What was written, null when nothing was. */
  text: string | null;
  /** The answers picked, by Kajabi's key and by their wording as shown in the submission (either may be empty). */
  optionKeys: string[];
  optionLabels: string[];
  file: ParsedFile | null;
  /** Where the question sits in the quiz (1-based) when the submission says: the join to a Hub question when it names no question id. */
  position?: number | null;
  /** Kajabi's own name for the question's type, as it came (its enum value, never member data). */
  questionType?: string | null;
}

export interface ParsedSubmission {
  submissionKey: string;
  /** Lower case. */
  email: string;
  submittedAt: string | null;
  answers: ParsedAnswer[];
}

/** A row of the Results tab: enough to open the submission and to tell it from another. */
export interface SubmissionRef {
  submissionKey: string;
  email: string | null;
  submittedAt: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

const views = (documents: unknown[]): unknown[] =>
  documents.flatMap((d) => {
    const resolved = resolveJsonApi(d);
    return resolved === d ? [d] : [resolved, d];
  });

const EMAIL_KEYS = ["email", "emailaddress", "useremail", "studentemail", "contactemail", "memberemail", "respondentemail"].map(norm);
const DATE_KEYS = ["submittedat", "datesubmittedat", "datesubmitted", "completedat", "createdat", "submissiondate", "date", "submitted"].map(norm);
const QUESTION_ID_KEYS = ["questionid", "quizquestionid", "questionkey"].map(norm);
const QUESTION_TEXT_KEYS = ["questiontext", "question", "prompt", "questiontitle", "questionbody", "title"].map(norm);
const TEXT_KEYS = ["answertext", "textanswer", "response", "responsetext", "answer", "body", "value", "text", "content", "freetext"].map(norm);
const OPTION_ID_KEYS = ["answerid", "answerids", "quizanswerid", "quizanswerids", "selectedanswerid", "selectedanswerids", "optionid", "optionids", "selectedoptionid", "selectedoptionids", "choiceid", "choiceids"].map(norm);
const OPTION_LIST_KEYS = ["selectedanswers", "selectedoptions", "selectedchoices", "answers", "options", "choices", "quizanswers", "selected"].map(norm);
const CHOICE_TITLE_KEYS = ["choicetitle"].map(norm);
const CHOICE_POSITION_KEYS = ["choiceposition"].map(norm);
const SELECTED_KEYS = ["selected", "isselected", "chosen", "ischosen"].map(norm);
const POSITION_KEYS = ["questionposition", "position", "questionorder", "questionindex"].map(norm);
const QUESTION_TYPE_KEYS = ["questiontype", "type", "kind"].map(norm);
const FILE_LINK_KEYS = ["fileurl", "filelink", "attachmenturl", "uploadurl", "downloadurl"].map(norm);
const FILE_LABEL_KEYS = ["filename", "originalfilename", "attachmentname"].map(norm);
const FILE_KEYS = ["file", "files", "attachment", "attachments", "upload", "uploads", "fileupload", "uploadedfile", "document"].map(norm);
const FILE_URL_KEYS = ["url", "fileurl", "downloadurl", "href", "link", "signedurl", "src"].map(norm);
const FILE_NAME_KEYS = ["filename", "name", "originalfilename", "title", "label"].map(norm);
const FILE_SIZE_KEYS = ["size", "filesize", "bytesize", "bytes", "contentlength"].map(norm);

const asEmail = (v: unknown): string | null => (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().toLowerCase() : null);

/** The first email found for any of the email-like keys, searching the whole value depth first. */
function findEmail(node: unknown, depth = 0): string | null {
  if (depth > 10 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findEmail(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, value] of Object.entries(node)) {
    if (EMAIL_KEYS.includes(norm(key))) {
      const email = asEmail(value);
      if (email) return email;
    }
  }
  for (const value of Object.values(node)) {
    const found = findEmail(value, depth + 1);
    if (found) return found;
  }
  return null;
}

const instantOf = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string") return parseKajabiInstant(v, ORG_TIMEZONE);
  const parsed = new Date(v < 1e12 ? v * 1000 : v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

function findDate(node: unknown, depth = 0): string | null {
  if (depth > 10 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findDate(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const name of DATE_KEYS) {
    const entry = Object.entries(node).find(([k]) => norm(k) === name);
    const at = entry ? instantOf(entry[1]) : null;
    if (at) return at;
  }
  for (const value of Object.values(node)) {
    const found = findDate(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The submissions a Results tab lists: objects with an email and either a date or an id of their own, de-duplicated by key. */
export function submissionsListedIn(documents: unknown[]): SubmissionRef[] {
  const found = new Map<string, SubmissionRef>();
  for (const list of views(documents).flatMap((v) => listsIn(v))) {
    for (const item of list) {
      const email = findEmail(item, 8);
      const key = keyText(item.id) ?? keyText(valueOf(item, ["submissionid", "quizsubmissionid", "attemptid"].map(norm)));
      if (!email || !key) continue;
      // A question or an answer inside a submission also has an id; a listed submission carries its responder.
      const ownEmail = Object.entries(item).some(([k, v]) => EMAIL_KEYS.includes(norm(k)) && asEmail(v)) || Object.values(item).some((v) => isObj(v) && findEmail(v, 6) !== null);
      if (!ownEmail) continue;
      if (!found.has(key)) found.set(key, { submissionKey: key, email, submittedAt: findDate(item, 4) });
    }
  }
  return [...found.values()];
}

/** Text of an answer, keeping the writer's line breaks (the quiz-capture `plainText` collapses them). */
export function answerText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(/\r\n?/g, "\n").replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  }
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? null : text;
}

const idList = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(keyText).filter((id): id is string => id !== null);

function fileOf(value: unknown): ParsedFile | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return { name: decodeURIComponent(c.split("?")[0].split("/").pop() || "file"), bytes: null, sourceUrl: c };
    if (!isObj(c)) continue;
    const urlEntry = FILE_URL_KEYS.map((k) => Object.entries(c).find(([key]) => norm(key) === k)).find((e) => e && typeof e[1] === "string" && /^https?:\/\//.test(e[1] as string));
    const nameEntry = FILE_NAME_KEYS.map((k) => Object.entries(c).find(([key]) => norm(key) === k)).find((e) => e && typeof e[1] === "string" && (e[1] as string).trim() !== "");
    const sizeEntry = FILE_SIZE_KEYS.map((k) => Object.entries(c).find(([key]) => norm(key) === k)).find((e) => e && typeof e[1] === "number");
    if (!urlEntry && !nameEntry) continue;
    const sourceUrl = urlEntry ? (urlEntry[1] as string) : null;
    const name = nameEntry ? (nameEntry[1] as string).trim() : decodeURIComponent((sourceUrl ?? "file").split("?")[0].split("/").pop() || "file");
    return { name, bytes: sizeEntry ? Math.round(sizeEntry[1] as number) : null, sourceUrl };
  }
  return null;
}

/** A JSON:API resource's fields, with `attributes` folded in. */
const flat = (raw: Obj): Obj => (isObj(raw.attributes) ? { ...raw, ...raw.attributes } : raw);

/**
 * One choice of a choice question, as Kajabi's submission lists it: every choice of the question is its own record, with its title and
 * place and whether it was `selected`. A record with a choice title but no `selected` field says nothing about what was picked, and is
 * left to the older reading.
 */
function isChoiceRecord(o: Obj): boolean {
  return valueOf(o, CHOICE_TITLE_KEYS) !== undefined && typeof valueOf(o, SELECTED_KEYS) === "boolean";
}

interface ChoiceGroup {
  prompt: string | null;
  position: number | null;
  questionType: string | null;
  /** The choices picked, by their record id. */
  picked: Map<string, { title: string; place: number }>;
}

/** The question a choice record belongs to, by id or position as `answerOf` names it, and what was picked of it. */
function choiceGroupsIn(all: unknown[]): Map<string, ChoiceGroup> {
  const groups = new Map<string, ChoiceGroup>();
  for (const v of all) {
    for (const list of listsIn(v)) {
      for (const raw of list) {
        const o = flat(raw);
        if (!isChoiceRecord(o)) continue;
        const questionObj = ["question", "quizquestion"].map((k) => Object.entries(o).find(([key]) => norm(key) === k)?.[1]).find(isObj);
        const positionRaw = valueOf(o, POSITION_KEYS);
        const position = typeof positionRaw === "number" && Number.isInteger(positionRaw) && positionRaw >= 0 ? positionRaw : null;
        const key = keyText(valueOf(o, QUESTION_ID_KEYS)) ?? (questionObj ? keyText(questionObj.id) : null) ?? (position !== null ? `pos:${position}` : null);
        if (!key) continue;
        const typeRaw = valueOf(o, QUESTION_TYPE_KEYS);
        const title = valueOf(o, ["questiontitle"].map(norm));
        const group = groups.get(key) ?? { prompt: typeof title === "string" ? plainText(title) || null : null, position, questionType: typeof typeRaw === "string" && typeRaw.trim() !== "" ? typeRaw.trim().slice(0, 60) : null, picked: new Map() };
        groups.set(key, group);
        if (valueOf(o, SELECTED_KEYS) !== true) continue;
        const label = plainText(valueOf(o, CHOICE_TITLE_KEYS));
        if (!label) continue;
        const place = valueOf(o, CHOICE_POSITION_KEYS);
        group.picked.set(keyText(o.id) ?? label, { title: label, place: typeof place === "number" ? place : Number.MAX_SAFE_INTEGER });
      }
    }
  }
  return groups;
}

/** What kind of answer a question's type name asks for, by whatever it is called: a file, a choice (multiple choice, checkboxes) or free text. Null when the name says none of these. */
export function kindOfTypeName(name: string | null | undefined): "file_upload" | "choice" | "short_answer" | null {
  if (!name) return null;
  if (/file|upload|attach/i.test(name)) return "file_upload";
  if (/choice|checkbox|radio|select|multiple|option/i.test(name)) return "choice";
  if (/short|text|essay|open|free/i.test(name)) return "short_answer";
  return null;
}

/**
 * One answer from an object, or null when it names no question or carries no answer at all (a question left unanswered is not an
 * answer). A question is named by its id, or, when the submission carries none (Kajabi's own answers don't), by its position in the
 * quiz: key `pos:<n>` with the question's title as its wording.
 */
function answerOf(raw: Obj): ParsedAnswer | null {
  // A JSON:API resource keeps its fields under `attributes`.
  const o: Obj = isObj(raw.attributes) ? { ...raw, ...raw.attributes } : raw;
  // One of a choice question's choices (picked or not) is not an answer: `choiceGroupsIn` reads which were picked.
  if (isChoiceRecord(o)) return null;
  const questionObj = ["question", "quizquestion"].map((k) => Object.entries(o).find(([key]) => norm(key) === k)?.[1]).find(isObj);
  const positionRaw = valueOf(o, POSITION_KEYS);
  const position = typeof positionRaw === "number" && Number.isInteger(positionRaw) && positionRaw >= 0 ? positionRaw : null;
  const questionKey = keyText(valueOf(o, QUESTION_ID_KEYS)) ?? (questionObj ? keyText(questionObj.id) : null) ?? (position !== null ? `pos:${position}` : null);
  if (!questionKey) return null;
  const typeRaw = valueOf(o, QUESTION_TYPE_KEYS);
  const questionType = typeof typeRaw === "string" && typeRaw.trim() !== "" ? typeRaw.trim().slice(0, 60) : null;
  const kind = kindOfTypeName(questionType);

  let prompt: string | null = null;
  if (questionObj) prompt = plainText(questionObj.text ?? questionObj.prompt ?? questionObj.title ?? questionObj.body ?? questionObj.question) || null;
  if (!prompt) {
    for (const name of QUESTION_TEXT_KEYS) {
      const entry = Object.entries(o).find(([k]) => norm(k) === name);
      const t = entry && typeof entry[1] === "string" ? plainText(entry[1]) : "";
      if (t && name !== "title") {
        prompt = t;
        break;
      }
    }
  }

  // Files first: a file's own fields (a name, a url) must not be read as text.
  let file: ParsedFile | null = null;
  const linkEntry = FILE_LINK_KEYS.map((k) => Object.entries(o).find(([key]) => norm(key) === k)).find((e) => e && typeof e[1] === "string" && /^https?:\/\//.test(e[1] as string));
  if (linkEntry) {
    file = fileOf(linkEntry[1]);
    const label = FILE_LABEL_KEYS.map((k) => Object.entries(o).find(([key]) => norm(key) === k)).find((e) => e && typeof e[1] === "string" && (e[1] as string).trim() !== "");
    if (file && label) file = { ...file, name: (label[1] as string).trim() };
  }
  for (const name of file ? [] : FILE_KEYS) {
    const entry = Object.entries(o).find(([k]) => norm(k) === name);
    file = entry ? fileOf(entry[1]) : null;
    if (file) break;
  }

  const optionKeys: string[] = [];
  const optionLabels: string[] = [];
  for (const name of OPTION_ID_KEYS) {
    const entry = Object.entries(o).find(([k]) => norm(k) === name);
    if (entry && entry[1] !== null && entry[1] !== undefined) optionKeys.push(...idList(entry[1]));
  }
  for (const name of OPTION_LIST_KEYS) {
    const entry = Object.entries(o).find(([k]) => norm(k) === name);
    if (!entry || !Array.isArray(entry[1])) continue;
    for (const item of entry[1]) {
      if (!isObj(item)) continue;
      const id = keyText(item.id);
      if (id) optionKeys.push(id);
      const label = plainText(item.text ?? item.label ?? item.answer ?? item.title ?? item.body);
      if (label) optionLabels.push(label);
    }
  }

  // A choice question's answer is the text of what was chosen (one per line when several).
  if (kind === "choice" && !file && optionLabels.length === 0) {
    for (const line of (answerText(valueOf(o, TEXT_KEYS)) ?? "").split("\n")) if (line.trim() !== "" && line.trim() !== prompt) optionLabels.push(line.trim());
  }

  let text: string | null = null;
  if (!file && optionKeys.length === 0 && optionLabels.length === 0 && kind !== "choice") {
    for (const name of TEXT_KEYS) {
      const entry = Object.entries(o).find(([k]) => norm(k) === name);
      const t = entry ? answerText(entry[1]) : null;
      // The question's own wording can sit under one of these names; it is not an answer.
      if (t && t !== prompt) {
        text = t;
        break;
      }
    }
  }
  if (!file && !text && optionKeys.length === 0 && optionLabels.length === 0) return null;
  return { questionKey, prompt, text, optionKeys: [...new Set(optionKeys)], optionLabels: [...new Set(optionLabels)], file, position, questionType };
}

/**
 * One submission out of the documents its grading view loaded; null when no email or no answer could be read.
 * `fallbackKey` is the key the capture knows it by (from the Results list or the address).
 */
export function parseSubmission(documents: unknown[], fallbackKey: string | null = null): ParsedSubmission | null {
  const all = views(documents);
  const email = all.map((v) => findEmail(v)).find((e): e is string => e !== null) ?? null;
  if (!email) return null;

  const groups = choiceGroupsIn(all);
  let best: ParsedAnswer[] = [];
  for (const v of all) {
    for (const list of listsIn(v)) {
      const answers = list.map(answerOf).filter((a): a is ParsedAnswer => a !== null);
      if (answers.length > best.length) {
        best = answers;
      }
    }
  }
  if (best.length === 0 && groups.size === 0) return null;
  // The same question seen twice (in two documents) is one answer; the one with more in it wins.
  const byQuestion = new Map<string, ParsedAnswer>();
  for (const a of best) {
    const had = byQuestion.get(a.questionKey);
    const weight = (x: ParsedAnswer) => (x.text?.length ?? 0) + x.optionKeys.length + x.optionLabels.length + (x.file ? 1 : 0);
    if (!had || weight(a) > weight(had)) byQuestion.set(a.questionKey, a);
  }
  // A choice question: only the choices that were picked count, by their wording (the record lists every choice, and the answer's own
  // list of choices names them all). Nothing picked and no text of its own is no answer.
  for (const [key, group] of groups) {
    const labels = [...group.picked.values()].sort((a, b) => a.place - b.place).map((c) => c.title);
    const own = byQuestion.get(key);
    if (labels.length === 0 && !own) continue;
    const base: ParsedAnswer = own ?? { questionKey: key, prompt: group.prompt, text: null, optionKeys: [], optionLabels: [], file: null, position: group.position, questionType: group.questionType };
    const kept = labels.length > 0 ? labels : own!.optionLabels.length > 0 ? own!.optionLabels : own!.text ? [own!.text] : [];
    if (kept.length === 0) {
      byQuestion.delete(key);
      continue;
    }
    byQuestion.set(key, { ...base, optionKeys: [], optionLabels: kept, text: null });
  }

  const holderKey = all.flatMap((v) => (isObj(v) ? [keyText(v.id)] : [])).find((k) => k !== null) ?? null;
  const submissionKey = fallbackKey ?? holderKey;
  if (!submissionKey) return null;
  return { submissionKey, email, submittedAt: all.map((v) => findDate(v)).find((d) => d !== null) ?? null, answers: [...byQuestion.values()] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Saving to Bronze
// ---------------------------------------------------------------------------------------------------------------------

/** What Bronze keeps of an answer's file: where it came from and where our copy is. */
export interface StoredFile extends ParsedFile {
  storagePath: string | null;
  /** Why no copy was made, in a word (no names): `expired`, `too_big`, `type`, `empty`, `no_link`, `http`, `network`. */
  copyFailure: string | null;
}

export interface StoredAnswer extends Omit<ParsedAnswer, "file"> {
  file: StoredFile | null;
}

export interface ResponseRow {
  quizKajabiId: string;
  submissionKey: string;
  courseKajabiId: string;
  email: string;
  submittedAt: string | null;
  answers: StoredAnswer[];
}

/** The same submission hashes the same: the answers' content, not where a file's copy is. */
export function responseContentHash(row: Pick<ResponseRow, "email" | "submittedAt" | "answers">): string {
  const content = {
    email: row.email,
    submittedAt: row.submittedAt,
    answers: [...row.answers]
      .sort((a, b) => (a.questionKey < b.questionKey ? -1 : 1))
      .map((a) => ({ ...a, optionKeys: [...a.optionKeys].sort(), optionLabels: [...a.optionLabels].sort(), file: a.file ? { name: a.file.name, bytes: a.file.bytes, sourceUrl: a.file.sourceUrl } : null })),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** The JSON stored in `answers`, snake_case as the SQL and the Silver step read it. */
export function answersToJson(answers: StoredAnswer[]): unknown[] {
  return answers.map((a) => ({
    question_key: a.questionKey,
    prompt: a.prompt,
    text: a.text,
    option_keys: a.optionKeys,
    option_labels: a.optionLabels,
    position: a.position ?? null,
    question_type: a.questionType ?? null,
    file: a.file ? { name: a.file.name, bytes: a.file.bytes, source_url: a.file.sourceUrl, storage_path: a.file.storagePath, copy_failure: a.file.copyFailure } : null,
  }));
}

/** The reverse of `answersToJson`, tolerant of a row that doesn't fit (it reads what is there). */
export function answersFromJson(json: unknown): StoredAnswer[] {
  if (!Array.isArray(json)) return [];
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return json.flatMap((raw): StoredAnswer[] => {
    if (!isObj(raw) || typeof raw.question_key !== "string") return [];
    const f = isObj(raw.file) ? raw.file : null;
    return [
      {
        questionKey: raw.question_key,
        prompt: typeof raw.prompt === "string" ? raw.prompt : null,
        text: typeof raw.text === "string" ? raw.text : null,
        optionKeys: strings(raw.option_keys),
        optionLabels: strings(raw.option_labels),
        position: typeof raw.position === "number" ? raw.position : null,
        questionType: typeof raw.question_type === "string" ? raw.question_type : null,
        file: f
          ? {
              name: typeof f.name === "string" ? f.name : "file",
              bytes: typeof f.bytes === "number" ? f.bytes : null,
              sourceUrl: typeof f.source_url === "string" ? f.source_url : null,
              storagePath: typeof f.storage_path === "string" ? f.storage_path : null,
              copyFailure: typeof f.copy_failure === "string" ? f.copy_failure : null,
            }
          : null,
      },
    ];
  });
}

export type ResponseSaveOutcome = "created" | "updated" | "unchanged";

/**
 * Writes one submission to Bronze. A submission whose content hasn't changed and whose files are copied as well as before writes
 * nothing. A file already copied for the same source keeps its copy (`previous`), so a re-run doesn't download it again.
 */
export async function saveQuizResponse(supabase: SupabaseClient, row: ResponseRow, now: Date, { dryRun = false }: { dryRun?: boolean } = {}): Promise<ResponseSaveOutcome> {
  const repo = new SupabaseKajabiCourseRepository(supabase as Db);
  const hash = responseContentHash(row);
  const existing = await repo.quizResponse(row.quizKajabiId, row.submissionKey);
  const sameCopies = existing && JSON.stringify(answersToJson(answersFromJson(existing.answers))) === JSON.stringify(answersToJson(row.answers));
  if (existing && existing.deleted_at === null && existing.content_hash === hash && sameCopies) return "unchanged";
  if (!dryRun) {
    await repo.saveQuizResponse({
      quiz_kajabi_id: row.quizKajabiId,
      submission_key: row.submissionKey,
      course_kajabi_id: row.courseKajabiId,
      email: row.email,
      submitted_at: row.submittedAt,
      answers: asJson(answersToJson(row.answers)),
      content_hash: hash,
      captured_at: now.toISOString(),
      deleted_at: null,
    });
  }
  return existing ? "updated" : "created";
}

// ---------------------------------------------------------------------------------------------------------------------
// Copying uploaded files into storage
// ---------------------------------------------------------------------------------------------------------------------

export interface FileCopyIO {
  /** The bytes behind a source address, or why not (`expired` for a refusal that a stale signed link gives). */
  download(url: string): Promise<{ ok: true; bytes: Uint8Array; contentType: string | null } | { ok: false; failure: "expired" | "http" | "network" }>;
  /** Stores bytes at a path of the private answer-files bucket; false when storage refused. */
  upload(path: string, bytes: Uint8Array, contentType: string | null): Promise<boolean>;
}

/** What copying a submission's files did, as counts. */
export interface FileCopyCounts {
  copied: number;
  alreadyCopied: number;
  failed: Record<string, number>;
}

export type FileCheck = (name: string, bytes: number) => { ok: true } | { ok: false; error: string };

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-120) || "file";

/**
 * Copies the files of one submission into the private bucket under `kajabi-import/<quiz>/<submission>/<name>` and returns the answers
 * with where each copy is (or why there is none). A file that already has a copy for the same source is kept; one that is too big
 * or of a kind the answers don't take is not copied and is counted (the Hub's own limits, the same as a member's upload). Never
 * throws for a file: a failure is a reason code on that file.
 */
export async function copyResponseFiles(
  io: FileCopyIO,
  check: FileCheck,
  input: { quizKajabiId: string; submissionKey: string; answers: StoredAnswer[]; previous?: StoredAnswer[] },
  dryRun: boolean,
): Promise<{ answers: StoredAnswer[]; counts: FileCopyCounts }> {
  const counts: FileCopyCounts = { copied: 0, alreadyCopied: 0, failed: {} };
  const fail = (reason: string) => (counts.failed[reason] = (counts.failed[reason] ?? 0) + 1);
  const previous = new Map((input.previous ?? []).map((a) => [a.questionKey, a.file]));
  const answers: StoredAnswer[] = [];
  for (const answer of input.answers) {
    if (!answer.file) {
      answers.push(answer);
      continue;
    }
    const file = answer.file;
    const before = previous.get(answer.questionKey);
    if (before?.storagePath && before.name === file.name && before.sourceUrl !== null) {
      counts.alreadyCopied++;
      answers.push({ ...answer, file: { ...file, bytes: before.bytes ?? file.bytes, storagePath: before.storagePath, copyFailure: null } });
      continue;
    }
    if (!file.sourceUrl) {
      fail("no_link");
      answers.push({ ...answer, file: { ...file, storagePath: null, copyFailure: "no_link" } });
      continue;
    }
    const downloaded = await io.download(file.sourceUrl);
    if (!downloaded.ok) {
      fail(downloaded.failure);
      answers.push({ ...answer, file: { ...file, storagePath: null, copyFailure: downloaded.failure } });
      continue;
    }
    if (downloaded.bytes.byteLength === 0) {
      fail("empty");
      answers.push({ ...answer, file: { ...file, storagePath: null, copyFailure: "empty" } });
      continue;
    }
    const verdict = check(file.name, downloaded.bytes.byteLength);
    if (!verdict.ok) {
      const reason = downloaded.bytes.byteLength > 0 && /MB/.test(verdict.error) ? "too_big" : "type";
      fail(reason);
      answers.push({ ...answer, file: { ...file, bytes: downloaded.bytes.byteLength, storagePath: null, copyFailure: reason } });
      continue;
    }
    const path = `${IMPORT_FILE_PREFIX}/${safeName(input.quizKajabiId)}/${safeName(input.submissionKey)}/${safeName(file.name)}`;
    const stored = dryRun ? true : await io.upload(path, downloaded.bytes, downloaded.contentType);
    if (!stored) {
      fail("storage");
      answers.push({ ...answer, file: { ...file, bytes: downloaded.bytes.byteLength, storagePath: null, copyFailure: "storage" } });
      continue;
    }
    counts.copied++;
    answers.push({ ...answer, file: { ...file, bytes: downloaded.bytes.byteLength, storagePath: dryRun ? null : path, copyFailure: null } });
  }
  return { answers, counts };
}

/** Adds one copy run's counts to a total. */
export function addFileCounts(total: FileCopyCounts, more: FileCopyCounts): void {
  total.copied += more.copied;
  total.alreadyCopied += more.alreadyCopied;
  for (const [reason, n] of Object.entries(more.failed)) total.failed[reason] = (total.failed[reason] ?? 0) + n;
}

/** The Bronze answers of a stored row as the capture's `ParsedAnswer` shape needs them (for a re-run that wants the previous copies). */
export const storedAnswersOf = (answers: unknown): StoredAnswer[] => answersFromJson(answers);

// ---------------------------------------------------------------------------------------------------------------------
// What the Results list says about its pages, and which type names a capture saw
// ---------------------------------------------------------------------------------------------------------------------

export interface PageMeta {
  currentPage: number;
  pageCount: number;
  /** Rows in all pages, when the list says. */
  itemsTotalCount: number | null;
}

/** The paging the list's own `meta` reports (JSON:API: `currentPage`, `pageCount`, `itemsTotalCount`), or null when no document has it. */
export function pageMetaOf(documents: unknown[]): PageMeta | null {
  for (const d of documents) {
    const meta = isObj(d) && isObj(d.meta) ? d.meta : null;
    if (!meta) continue;
    const num = (names: string[]) => {
      const v = valueOf(meta, names.map(norm));
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const currentPage = num(["currentpage", "page"]);
    const pageCount = num(["pagecount", "totalpages"]);
    if (currentPage === null || pageCount === null) continue;
    return { currentPage, pageCount, itemsTotalCount: num(["itemstotalcount", "totalcount", "total"]) };
  }
  return null;
}

/** The distinct values of the `type` and `questionType` fields found in the documents: Kajabi's own enum names, never member data, so they are safe to print. */
export function typeValuesIn(documents: unknown[]): { types: string[]; questionTypes: string[] } {
  const types = new Set<string>();
  const questionTypes = new Set<string>();
  const safe = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_. :/-]{1,60}$/.test(v) ? v : null);
  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const k = norm(key);
      const v = safe(value);
      if (v && k === "type") types.add(v);
      else if (v && k === "questiontype") questionTypes.add(v);
      else visit(value, depth + 1);
    }
  };
  for (const d of documents) visit(d, 0);
  return { types: [...types].sort().slice(0, 30), questionTypes: [...questionTypes].sort().slice(0, 30) };
}

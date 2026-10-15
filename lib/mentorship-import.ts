import {
  matchAttendeeToMember,
  type Member,
  type MemberAlias,
  type MemberEmailAlias,
} from "./member-matching";

// Relative imports, not "@/": this is also loaded by a script run with tsx.
// One-off import of Big Sister matches from a spreadsheet export (scripts/import-mentorships.ts).
// The CSV has a header row and the columns mentor, trial, trial_start (YYYY-MM-DD) and note;
// mentor_email / trial_email are optional and win over the name when a name can't be resolved.

export interface ImportRow {
  line: number;
  mentor: string;
  trial: string;
  trialStart: string;
  note: string;
  mentorEmail: string;
  trialEmail: string;
}

/** Splits CSV text into records, honoring quoted fields ("a, b", "say ""hi"""). */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((f) => f.trim() !== "")) records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  record.push(field);
  if (record.some((f) => f.trim() !== "")) records.push(record);
  return records;
}

export function toImportRows(records: string[][]): ImportRow[] {
  const [header, ...body] = records;
  if (!header) return [];
  const col = (name: string) => header.map((h) => h.trim().toLowerCase()).indexOf(name);
  const idx = {
    mentor: col("mentor"),
    trial: col("trial"),
    start: col("trial_start"),
    note: col("note"),
    mentorEmail: col("mentor_email"),
    trialEmail: col("trial_email"),
  };
  if (idx.mentor < 0 || idx.trial < 0 || idx.start < 0) {
    throw new Error("The CSV needs the columns mentor, trial and trial_start.");
  }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return body.map((r, n) => ({
    line: n + 2,
    mentor: cell(r, idx.mentor),
    trial: cell(r, idx.trial),
    trialStart: cell(r, idx.start),
    note: cell(r, idx.note),
    mentorEmail: cell(r, idx.mentorEmail),
    trialEmail: cell(r, idx.trialEmail),
  }));
}

export interface PlannedMatch {
  line: number;
  mentor: Member;
  trial: Member;
  startedOn: string;
  note: string | null;
  /** How each side was resolved, for the report. */
  how: { mentor: string; trial: string };
}

export interface ImportProblem {
  line: number;
  message: string;
}

export interface ImportPlan {
  matches: PlannedMatch[];
  problems: ImportProblem[];
}

interface Resolution {
  member?: Member;
  how?: string;
  problem?: string;
}

function resolve(
  who: string,
  name: string,
  email: string,
  members: Member[],
  aliases: MemberAlias[],
  emailAliases: MemberEmailAlias[]
): Resolution {
  if (!name && !email) return { problem: `${who} is empty` };
  const result = matchAttendeeToMember(name, email || null, members, aliases, emailAliases);
  if (!result) return { problem: `${who} "${name}" matches no member` };
  if ("reason" in result) {
    const names = result.candidates.map((c) => `${c.name} <${c.email}>`).join("; ");
    return { problem: `${who} "${name}" is ambiguous: ${names}` };
  }
  return { member: members.find((m) => m.id === result.member_id), how: result.method };
}

/**
 * Resolves each row to members and drops rows that can't be imported, reporting why. The same
 * trial member appearing twice (a spreadsheet repeats a match on each tab it was carried to) keeps
 * the later row; one already matched in the database is skipped.
 */
export function planImport(
  rows: ImportRow[],
  members: Member[],
  aliases: MemberAlias[],
  emailAliases: MemberEmailAlias[],
  alreadyMatchedTrialIds: Set<string>
): ImportPlan {
  const problems: ImportProblem[] = [];
  const byTrial = new Map<string, PlannedMatch>();

  for (const row of rows) {
    if (!row.trial && !row.trialEmail) continue; // a big sister listed with no trial member yet
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.trialStart)) {
      problems.push({ line: row.line, message: `trial_start "${row.trialStart}" is not a YYYY-MM-DD date` });
      continue;
    }
    const mentor = resolve("big sister", row.mentor, row.mentorEmail, members, aliases, emailAliases);
    const trial = resolve("trial member", row.trial, row.trialEmail, members, aliases, emailAliases);
    const failed = [mentor.problem, trial.problem].filter(Boolean);
    if (failed.length > 0 || !mentor.member || !trial.member) {
      for (const message of failed) problems.push({ line: row.line, message: message! });
      continue;
    }
    if (mentor.member.id === trial.member.id) {
      problems.push({ line: row.line, message: `${mentor.member.name} is both big sister and trial member` });
      continue;
    }
    if (alreadyMatchedTrialIds.has(trial.member.id)) {
      problems.push({ line: row.line, message: `${trial.member.name} already has a big sister in the database` });
      continue;
    }
    const earlier = byTrial.get(trial.member.id);
    if (earlier) {
      problems.push({ line: earlier.line, message: `${trial.member.name} appears again on line ${row.line}; using that one` });
    }
    byTrial.set(trial.member.id, {
      line: row.line,
      mentor: mentor.member,
      trial: trial.member,
      startedOn: row.trialStart,
      note: row.note || null,
      how: { mentor: mentor.how ?? "", trial: trial.how ?? "" },
    });
  }

  return { matches: [...byTrial.values()], problems };
}

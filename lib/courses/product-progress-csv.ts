/**
 * Parser for Kajabi's "Product Progress" report CSV (admin -> a product -> Export). One row per
 * student: how much of the whole product they completed, not per lesson. See docs/COURSES.md,
 * "Importing Kajabi per-lesson progress".
 *
 * Columns are found by header name (case-insensitive, any order, extras ignored). The file does not
 * say which product it is for; the admin picks the course on upload. Invalid rows are reported with
 * their line number and a reason, never with the row's content (names and emails are member data).
 */

export interface ProgressRow {
  /** Lowercased and trimmed. */
  email: string;
  /** 0 to 100. */
  percent: number;
  logins: number | null;
  /** YYYY-MM-DD, or null for "Not Started" / blank. */
  startedOn: string | null;
  lastActivityOn: string | null;
}

export interface InvalidRow {
  /** 1-based line in the file where the record starts (the header is line 1). */
  line: number;
  reason: string;
}

export interface ParsedProgress {
  /** Data records read, valid or not (blank lines excluded). */
  rowsRead: number;
  rows: ProgressRow[];
  invalid: InvalidRow[];
}

export class ProgressCsvError extends Error {}

/** RFC 4180 reader: quoted fields may hold commas, quotes ("") and line breaks. Returns records with their start line. */
function readRecords(text: string): { fields: string[]; line: number }[] {
  const records: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let pending = false; // something was read for the current record

  const endRecord = () => {
    if (pending || fields.length > 0) {
      fields.push(field);
      records.push({ fields, line: recordLine });
    }
    fields = [];
    field = "";
    pending = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      pending = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
      pending = true;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
      pending = true;
    }
  }
  endRecord();
  return records;
}

const EMAIL = /^[^\s@,;"<>]+@[^\s@,;"<>]+\.[^\s@,;"<>]+$/;
const NO_DATE = new Set(["", "not started", "never", "n/a", "na", "-", "--", "none", "null"]);

/** A real calendar date as YYYY-MM-DD (an ISO date-time is cut to its date), null for "not started"; undefined if unreadable. */
function parseDate(value: string): string | null | undefined {
  const v = value.trim();
  if (NO_DATE.has(v.toLowerCase())) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** "62", "62%", " 62.5 % " -> a number from 0 to 100; undefined if not one. */
function parsePercent(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?|\.\d+)\s*%?$/.exec(value.trim());
  if (!m) return undefined;
  const n = Math.round(Number(m[1]) * 100) / 100;
  return n >= 0 && n <= 100 ? n : undefined;
}

function parseLogins(value: string): number | null | undefined {
  const v = value.trim().replace(/,/g, "");
  if (v === "" || NO_DATE.has(v.toLowerCase())) return null;
  return /^\d+$/.test(v) ? Number(v) : undefined;
}

/** Parses the CSV text. Throws ProgressCsvError when it is not a usable Product Progress report. */
export function parseProductProgressCsv(input: string): ParsedProgress {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records = readRecords(text);
  const headerRecord = records.find((r) => r.fields.some((f) => f.trim() !== ""));
  if (!headerRecord) throw new ProgressCsvError("The file is empty.");

  const headers = headerRecord.fields.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const emailCol = col("email", "email address");
  const percentCol = col("product progress", "progress");
  if (emailCol < 0 || percentCol < 0) {
    const missing = [emailCol < 0 ? "Email" : null, percentCol < 0 ? "Product Progress" : null].filter(Boolean).join(" and ");
    throw new ProgressCsvError(`Missing the ${missing} column. This does not look like Kajabi's Product Progress report.`);
  }
  const loginsCol = col("logins");
  const startCol = col("start date", "started", "started at");
  const lastCol = col("last activity at", "last activity", "last activity on");

  const rows: ProgressRow[] = [];
  const invalid: InvalidRow[] = [];
  const seen = new Set<string>();
  let rowsRead = 0;

  for (const record of records.slice(records.indexOf(headerRecord) + 1)) {
    if (record.fields.every((f) => f.trim() === "")) continue;
    rowsRead++;
    const get = (i: number) => (i >= 0 ? (record.fields[i] ?? "") : "");
    const bad = (reason: string) => invalid.push({ line: record.line, reason });

    const email = get(emailCol).trim().toLowerCase();
    if (!EMAIL.test(email)) {
      bad(email === "" ? "Email is missing" : "Email is not a valid address");
      continue;
    }
    const percentText = get(percentCol).trim();
    if (percentText === "") {
      bad("Product Progress is missing");
      continue;
    }
    const percent = parsePercent(percentText);
    if (percent === undefined) {
      bad("Product Progress is not a percentage from 0 to 100");
      continue;
    }
    const logins = parseLogins(get(loginsCol));
    if (logins === undefined) {
      bad("Logins is not a whole number");
      continue;
    }
    const startedOn = parseDate(get(startCol));
    if (startedOn === undefined) {
      bad("Start Date is not a date (expected YYYY-MM-DD, or Not Started)");
      continue;
    }
    const lastActivityOn = parseDate(get(lastCol));
    if (lastActivityOn === undefined) {
      bad("Last Activity At is not a date (expected YYYY-MM-DD)");
      continue;
    }
    if (seen.has(email)) {
      bad("Email appears more than once in the file");
      continue;
    }
    seen.add(email);
    rows.push({ email, percent, logins, startedOn, lastActivityOn });
  }

  return { rowsRead, rows, invalid };
}

/**
 * Pure parsers for the two JSON responses scripts/kajabi-course-content.ts records in `--progress` mode
 * (docs/COURSES.md, "Importing Kajabi per-lesson progress"):
 *
 *  - the Product Progress roster, `GET /api/client/reports/product_progress/{productId}`: one entry per student;
 *  - one student's report, `.../{productId}/members/{memberId}`: every module and week with its lessons.
 *
 * Both are tolerant: a missing or oddly typed field gives null (or skips the entry) instead of throwing, and
 * nothing here logs a value, since these responses are full of names and emails.
 */

export interface RosterEntry {
  contactId: string | null;
  memberId: string;
  /** Lowercased and trimmed. */
  email: string;
  percent: number;
  logins: number | null;
  /** YYYY-MM-DD in the organisation's timezone. */
  startedOn: string | null;
  lastActivityOn: string | null;
}

export interface ParsedRoster {
  /** Kajabi's own count; compare with entries.length (a mismatch means the roster is paged or filtered). */
  count: number | null;
  entries: RosterEntry[];
  /** Entries left out: no member id, or no usable email. */
  skipped: number;
}

export interface LessonEntry {
  /** Kajabi's post id, the same as bronze.kajabi_course_lessons.kajabi_id. */
  kajabiLessonId: string;
  completed: boolean;
  /** ISO instant, or null when Kajabi gives no date. */
  completedAt: string | null;
  percent: number | null;
}

export interface ParsedMemberProgress {
  memberId: string | null;
  contactId: string | null;
  lessons: LessonEntry[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An id Kajabi sends as a number or a string, as text. */
function idText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `timeZone` reads this date and time. */
function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const naive = Date.UTC(year, month - 1, day, hour);
  return new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60000);
}

/**
 * A Kajabi date as an ISO instant. A bare date ("2026-01-05") is read as noon in `timeZone`, so it stays that
 * day there; a timestamp is taken as given (no zone means UTC). Null for anything else.
 */
export function parseKajabiInstant(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v === "") return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (bare) {
    const [y, mo, d] = [Number(bare[1]), Number(bare[2]), Number(bare[3])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return zonedInstant(y, mo, d, 12, timeZone).toISOString();
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const parsed = new Date(hasZone ? v : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A Kajabi date or timestamp as the calendar day (YYYY-MM-DD) it falls on in `timeZone`. */
export function parseKajabiDay(value: unknown, timeZone: string): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const iso = parseKajabiInstant(value, timeZone);
    return iso ? value.trim() : null;
  }
  const iso = parseKajabiInstant(value, timeZone);
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}

const EMAIL = /^[^\s@,;"<>]+@[^\s@,;"<>]+\.[^\s@,;"<>]+$/;

export function parseRoster(json: unknown, timeZone: string): ParsedRoster {
  const root = isObject(json) ? json : {};
  const members = Array.isArray(root.members) ? root.members : [];
  const entries: RosterEntry[] = [];
  let skipped = 0;
  for (const m of members) {
    if (!isObject(m)) {
      skipped++;
      continue;
    }
    const memberId = idText(m.member_id);
    const email = typeof m.email === "string" ? m.email.trim().toLowerCase() : "";
    if (!memberId || !EMAIL.test(email)) {
      skipped++;
      continue;
    }
    const percentRaw = numberOrNull(m.percent_complete);
    const logins = numberOrNull(m.sign_in_count);
    entries.push({
      contactId: idText(m.contact_id),
      memberId,
      email,
      percent: percentRaw === null ? 0 : Math.min(100, Math.max(0, Math.round(percentRaw * 100) / 100)),
      logins: logins !== null && logins >= 0 ? Math.trunc(logins) : null,
      startedOn: parseKajabiDay(m.start_date, timeZone),
      lastActivityOn: parseKajabiDay(m.last_request_at, timeZone),
    });
  }
  return { count: numberOrNull(root.count), entries, skipped };
}

/**
 * Whether a roster response has students in it. Kajabi builds the report in the background (the request carries
 * `send_to_background`, the response a `status`), so the page's first answer can be an empty one and a later
 * answer has the students: the capture keeps watching until a response is ready.
 */
export function rosterHasMembers(json: unknown): boolean {
  return isObject(json) && Array.isArray(json.members) && json.members.length > 0;
}

/** What a roster response says about itself, for the line printed when no students ever arrived: the report's own status and count, never a student. */
export function describeRosterResponse(json: unknown): string {
  if (!isObject(json)) return "not an object";
  const status = typeof json.status === "string" ? json.status.slice(0, 40) : typeof json.status;
  const count = typeof json.count === "number" ? json.count : typeof json.count;
  const members = Array.isArray(json.members) ? json.members.length : typeof json.members;
  return `status ${status}, count ${count}, members ${members}`;
}

/** Request headers the browser sets itself or that would change the answer: never copied onto a request we make. */
const NOT_FORWARDED = /^(:.*|cookie|host|connection|content-length|accept-encoding|accept-language|user-agent|referer|origin|priority|upgrade-insecure-requests|if-none-match|if-modified-since|sec-.*)$/i;

/**
 * The headers of one of the page's own requests that another request of ours should carry: the app's custom
 * headers (a CSRF token, an authorization header...) that its API checks and a plain cookie does not supply.
 * Lowercased, and never anything the browser adds on its own.
 */
export function forwardableHeaders(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(all)) {
    const key = name.toLowerCase();
    if (!NOT_FORWARDED.test(key) && value !== "") out[key] = value;
  }
  return out;
}

/** Every lesson of every module and week in one student's report; a lesson listed twice keeps its completed copy. */
export function parseMemberProgress(json: unknown, timeZone: string): ParsedMemberProgress {
  const root = isObject(json) ? json : {};
  const member = isObject(root.member) ? root.member : {};
  const product = isObject(root.product) ? root.product : {};
  const categories = Array.isArray(product.categories) ? product.categories : [];
  const byId = new Map<string, LessonEntry>();
  for (const c of categories) {
    if (!isObject(c) || !Array.isArray(c.posts)) continue;
    for (const p of c.posts) {
      if (!isObject(p)) continue;
      const id = idText(p.id);
      if (!id) continue;
      const percentRaw = numberOrNull(p.progress_percent);
      const completed = p.completed === true;
      const entry: LessonEntry = {
        kajabiLessonId: id,
        completed,
        completedAt: completed ? parseKajabiInstant(p.completed_date, timeZone) : null,
        percent: percentRaw === null ? null : Math.min(100, Math.max(0, Math.round(percentRaw * 100) / 100)),
      };
      const earlier = byId.get(id);
      if (!earlier || (!earlier.completed && entry.completed)) byId.set(id, entry);
    }
  }
  return { memberId: idText(member.id), contactId: idText(member.contact_id), lessons: [...byId.values()] };
}

/** The member report's address for a roster URL: same origin, path and query, with `/members/{id}` appended. */
export function memberReportUrl(rosterUrl: string, memberId: string): string {
  const url = new URL(rosterUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/members/${encodeURIComponent(memberId)}`;
  return url.toString();
}

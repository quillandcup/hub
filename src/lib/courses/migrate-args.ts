// Argument parsing for scripts/courses-migrate.ts, kept apart so it can be tested without running anything.
// Anything it doesn't understand is an error: a mistyped flag must never fall back to a default that writes.

export interface MigrateArgs {
  /** The Kajabi course id. */
  courseId: string;
  envFile: string;
  /** Where the course routes are; null means "work it out from the env file" (production for .env.prod, the local server otherwise). */
  baseUrl: string | null;
  /** Answer yes to every question. Refuses to guess what only a person can decide (a new course's access length and launch date). */
  yes: boolean;
  /** An interval ("1 year"), or null for lifetime; undefined when not given. */
  accessDuration: string | null | undefined;
  /** A day (YYYY-MM-DD, Eastern) the course opens; undefined when not given. */
  launchOn: string | undefined;
  skipDrafts: boolean;
}

export type ParsedMigrateArgs = ({ ok: true } & MigrateArgs) | { ok: false; error: string };

export const MIGRATE_USAGE = [
  'Usage: pnpm courses:migrate --course <kajabi-course-id> [--env .env.prod] [--base-url <url>] [--yes] [--access-duration "1 year"|lifetime] [--launch-on YYYY-MM-DD] [--skip-drafts]',
  "  --course           the Kajabi course to migrate (required)",
  "  --env              env file with the Supabase keys and the secret (default .env.local); .env.prod targets production",
  "  --base-url         where the Hub's course routes are (default: production for .env.prod, the local dev server otherwise)",
  "  --yes              answer yes to every question, including the paid video upload",
  '  --access-duration  how long members keep access, like "1 year" or "6 months", or "lifetime" (asked for a course not published yet)',
  "  --launch-on        the day the course opens, YYYY-MM-DD in Eastern time (asked for a course not published yet)",
  "  --skip-drafts      leave draft lessons out of the content capture",
].join("\n");

const VALUE_FLAGS = ["course", "env", "base-url", "access-duration", "launch-on"] as const;
const BOOLEAN_FLAGS = ["yes", "skip-drafts"] as const;

const INTERVAL = /^(\d{1,3})\s*(day|week|month|year)s?$/i;

/** "1 year", "6 months", "lifetime" -> an interval for the route (null is lifetime); undefined if it is neither. */
export function parseAccessDuration(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (/^lifetime$/i.test(trimmed)) return null;
  const match = INTERVAL.exec(trimmed);
  if (!match || Number(match[1]) < 1) return undefined;
  const n = Number(match[1]);
  return `${n} ${match[2].toLowerCase()}${n === 1 ? "" : "s"}`;
}

/** A real calendar day written YYYY-MM-DD. */
export function isValidDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function parseMigrateArgs(argv: readonly string[]): ParsedMigrateArgs {
  const values: Partial<Record<(typeof VALUE_FLAGS)[number], string>> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, error: `Unexpected argument "${arg}"` };
    const name = match[1];
    if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      if (match[2] !== undefined) return { ok: false, error: `--${name} takes no value` };
      flags.add(name);
      continue;
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) return { ok: false, error: `Unknown option --${name}` };
    const flag = name as (typeof VALUE_FLAGS)[number];
    if (values[flag] !== undefined) return { ok: false, error: `--${flag} given more than once` };
    const value = match[2] !== undefined ? match[2] : argv[++i];
    if (value === undefined || value.startsWith("--") || value === "") return { ok: false, error: `--${flag} needs a value` };
    values[flag] = value;
  }

  if (!values.course) return { ok: false, error: "--course <kajabi-course-id> is required" };
  if (!/^\d+$/.test(values.course)) return { ok: false, error: "--course must be the Kajabi course id (digits only)" };

  let baseUrl: string | null = null;
  if (values["base-url"]) {
    let url: URL;
    try {
      url = new URL(values["base-url"]);
    } catch {
      return { ok: false, error: "--base-url must be a full http(s) address" };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "--base-url must be a full http(s) address" };
    baseUrl = url.origin + url.pathname.replace(/\/+$/, "");
  }

  let accessDuration: string | null | undefined;
  if (values["access-duration"] !== undefined) {
    accessDuration = parseAccessDuration(values["access-duration"]);
    if (accessDuration === undefined) return { ok: false, error: '--access-duration must be like "1 year", "6 months" or "lifetime"' };
  }

  if (values["launch-on"] !== undefined && !isValidDay(values["launch-on"])) {
    return { ok: false, error: "--launch-on must be a day written YYYY-MM-DD" };
  }

  return {
    ok: true,
    courseId: values.course,
    envFile: values.env ?? ".env.local",
    baseUrl,
    yes: flags.has("yes"),
    accessDuration,
    launchOn: values["launch-on"],
    skipDrafts: flags.has("skip-drafts"),
  };
}

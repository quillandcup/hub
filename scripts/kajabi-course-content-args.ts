// Argument parsing for scripts/kajabi-course-content.ts, kept apart so it can be tested without
// opening a browser. Anything it doesn't understand is an error, so a mistyped scoping flag never
// falls back to capturing (and writing) every lesson.

export interface ContentArgs {
  scope: { courseId: string } | { lessonId: string };
  envFile: string;
  /** Without it the run captures and reports, but writes nothing. */
  apply: boolean;
  includeDrafts: boolean;
  concurrency: number;
  headless: boolean;
  /** Browser profile directory, so the Kajabi login survives between runs. */
  profileDir: string | null;
}

export type ParsedContentArgs = ({ ok: true } & ContentArgs) | { ok: false; error: string };

export const CONTENT_USAGE = [
  "Usage: npm run courses:content -- (--course <kajabi-course-id> | --lesson <kajabi-lesson-id>) [options]",
  "  --course        capture every lesson of this Kajabi course that step A has imported",
  "  --lesson        capture just this lesson",
  "  --apply         write to the database (default: capture and report only)",
  "  --env           env file with the Supabase URL and service role key (default .env.local)",
  "  --include-drafts also capture draft lessons (skipped by default)",
  "  --concurrency   lessons captured at once (default 2, max 5)",
  "  --headless      no browser window (only once the saved login is still valid)",
  "  --profile       browser profile directory (default ~/.hub-kajabi-profile)",
].join("\n");

const VALUE_FLAGS = ["course", "lesson", "env", "concurrency", "profile"] as const;
const BOOLEAN_FLAGS = ["apply", "include-drafts", "headless"] as const;

export function parseContentArgs(argv: readonly string[]): ParsedContentArgs {
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

  if (values.course && values.lesson) return { ok: false, error: "Give --course or --lesson, not both" };
  if (!values.course && !values.lesson) return { ok: false, error: "Give --course or --lesson" };

  let concurrency = 2;
  if (values.concurrency !== undefined) {
    concurrency = Number(values.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
      return { ok: false, error: "--concurrency must be a whole number from 1 to 5" };
    }
  }

  return {
    ok: true,
    scope: values.course ? { courseId: values.course } : { lessonId: values.lesson! },
    envFile: values.env ?? ".env.local",
    apply: flags.has("apply"),
    includeDrafts: flags.has("include-drafts"),
    concurrency,
    headless: flags.has("headless"),
    profileDir: values.profile ?? null,
  };
}

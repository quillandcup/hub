// Argument parsing for scripts/kajabi-course-content.ts, kept apart so it can be tested without
// opening a browser. Anything it doesn't understand is an error, so a mistyped scoping flag never
// falls back to capturing (and writing) every lesson.

export interface ContentArgs {
  /** What to capture; null in probe mode, which reads no lessons. */
  scope: { courseId: string } | { lessonId: string } | null;
  /** Probe mode: open this page and print the shape of the JSON it loads while you click around. Writes nothing. */
  probe: { url: string; seconds: number } | null;
  envFile: string;
  /** Without it the run captures and reports, but writes nothing. */
  apply: boolean;
  /** Drafts are captured by default (staff can preview them); this leaves them out. */
  skipDrafts: boolean;
  /** Progress mode: capture every student's per-lesson completion for the course instead of lesson content. */
  progress: boolean;
  /** Also look for the course's hero banner on its admin product page. Off by default: it isn't there (docs/TODO.md, "Course Hero Image"). */
  hero: boolean;
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
  "  --env           env file with the Supabase URL and service role key (default .env.local); the .env.shared beside it is read too, and the file wins",
  "  --progress      with --course: capture every student's per-lesson progress (roster and one report per student) into Bronze instead of lesson content",
  "  --skip-drafts   leave draft lessons out (they are captured by default; staff preview them)",
  "  --hero          also look for the course's hero banner (experimental; the admin product page doesn't carry it)",
  "  --probe         instead of capturing, open this Kajabi admin page and print the paths and field names of the JSON it loads while you click around (no values; --seconds sets how long, default 90)",
  "  --concurrency   lessons captured at once (default 2, max 5)",
  "  --headless      no browser window (only once the saved login is still valid)",
  "  --profile       browser profile directory (default ~/.hub-kajabi-profile)",
].join("\n");

const VALUE_FLAGS = ["course", "lesson", "env", "concurrency", "profile", "probe", "seconds"] as const;
// include-drafts is the old opt-in, now the default; still accepted so existing commands keep working.
const BOOLEAN_FLAGS = ["apply", "skip-drafts", "include-drafts", "headless", "hero", "progress"] as const;

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

  if (flags.has("skip-drafts") && flags.has("include-drafts")) return { ok: false, error: "Give --skip-drafts or --include-drafts, not both" };
  if (values.course && values.lesson) return { ok: false, error: "Give --course or --lesson, not both" };
  if (flags.has("progress")) {
    if (!values.course) return { ok: false, error: "--progress needs --course <kajabi-course-id>" };
    if (flags.has("hero") || flags.has("skip-drafts") || flags.has("include-drafts")) {
      return { ok: false, error: "--progress captures progress only; --hero and the draft options are for lesson content" };
    }
  }
  if (values.probe && (values.course || values.lesson)) return { ok: false, error: "--probe takes a page, not --course or --lesson" };
  if (!values.probe && !values.course && !values.lesson) return { ok: false, error: "Give --course, --lesson or --probe" };
  if (values.seconds !== undefined && !values.probe) return { ok: false, error: "--seconds is for --probe" };

  let probe: ContentArgs["probe"] = null;
  if (values.probe) {
    let url: URL;
    try {
      url = new URL(values.probe);
    } catch {
      return { ok: false, error: "--probe needs a full https:// address" };
    }
    if (url.protocol !== "https:") return { ok: false, error: "--probe needs a full https:// address" };
    const seconds = values.seconds === undefined ? 90 : Number(values.seconds);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) return { ok: false, error: "--seconds must be a whole number from 10 to 600" };
    probe = { url: url.toString(), seconds };
  }

  let concurrency = 2;
  if (values.concurrency !== undefined) {
    concurrency = Number(values.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
      return { ok: false, error: "--concurrency must be a whole number from 1 to 5" };
    }
  }

  return {
    ok: true,
    scope: values.course ? { courseId: values.course } : values.lesson ? { lessonId: values.lesson } : null,
    probe,
    envFile: values.env ?? ".env.local",
    apply: flags.has("apply"),
    skipDrafts: flags.has("skip-drafts"),
    progress: flags.has("progress"),
    hero: flags.has("hero"),
    concurrency,
    headless: flags.has("headless"),
    profileDir: values.profile ?? null,
  };
}

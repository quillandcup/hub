// Argument parsing for scripts/adopt-book-covers.ts, kept apart so it can be tested without touching a
// database. Anything it doesn't understand is an error, so a mistyped flag never turns a dry run into a write.

export interface AdoptArgs {
  envFile: string;
  /** Without it the run reads and reports, but writes nothing. */
  apply: boolean;
}

export type ParsedAdoptArgs = ({ ok: true } & AdoptArgs) | { ok: false; error: string };

export const ADOPT_USAGE = [
  "Usage: pnpm covers:adopt [--env <file>] [--apply]",
  "  --env    env file with the Supabase URL and service role key (default .env.local); the .env.shared beside it is read too, and the file wins",
  "  --apply  move the covers (default: read them and report what would happen, writing nothing)",
].join("\n");

export function parseAdoptArgs(argv: readonly string[]): ParsedAdoptArgs {
  let envFile = ".env.local";
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--env" || arg.startsWith("--env=")) {
      const value = arg === "--env" ? argv[++i] : arg.slice("--env=".length);
      if (!value || value.startsWith("--")) return { ok: false, error: "--env needs a file name" };
      envFile = value;
    } else return { ok: false, error: `Unknown option: ${arg}` };
  }
  return { ok: true, envFile, apply };
}

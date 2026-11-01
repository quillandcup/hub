// Argument parsing for scripts/sync-to-vercel.ts and sync-to-github.ts, kept apart so it can be tested without running a
// sync. A mistyped scoping flag must never fall back to syncing everything, so anything this doesn't
// understand is an error rather than ignored.

export interface SyncArgs {
  /** Variable names to sync, or null for every Vercel variable. */
  only: Set<string> | null;
  /** Targets to sync to, or null for all of them. */
  targets: Set<string> | null;
}

export type ParsedSyncArgs = ({ ok: true } & SyncArgs) | { ok: false; error: string };

export const SYNC_USAGE = [
  "Usage: pnpm env:sync [--only=NAME[,NAME...]] [--target=preview|production[,...]]",
  "  --only    sync just these variables (a name that isn't synced to Vercel is an error)",
  "  --target  sync to just these Vercel environments",
  "  Both flags also take a space instead of =, e.g. --only NAME.",
].join("\n");

export const GITHUB_SYNC_USAGE = [
  "Usage: pnpm env:sync:github [--only=NAME[,NAME...]]",
  "  --only    sync just these variables (a name that isn't synced to GitHub is an error)",
  "  Also takes a space instead of =, e.g. --only NAME.",
].join("\n");

/**
 * @param argv     arguments after the script name
 * @param known    names of the variables that sync to the destination, and the targets that exist
 *                 (none for GitHub, which makes `--target` an unknown option); `destination`
 *                 names it in errors and defaults to Vercel
 */
export function parseSyncArgs(
  argv: readonly string[],
  known: { names: ReadonlySet<string>; targets: readonly string[]; destination?: string }
): ParsedSyncArgs {
  const values: Record<"only" | "target", string | undefined> = { only: undefined, target: undefined };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run script -- --only=X` hands the script a bare `--` first.
    if (arg === "--") continue;
    const match = /^--(only|target)(?:=(.*))?$/.exec(arg);
    if (!match || (match[1] === "target" && known.targets.length === 0)) {
      return { ok: false, error: arg.startsWith("-") ? `Unknown option ${arg}` : `Unexpected argument "${arg}"` };
    }
    const flag = match[1] as "only" | "target";
    if (values[flag] !== undefined) return { ok: false, error: `--${flag} given more than once` };
    // `--only=A` or `--only A`; the space form takes the next argument as its value.
    const value = match[2] !== undefined ? match[2] : argv[++i];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `--${flag} needs a value` };
    values[flag] = value;
  }

  const list = (raw: string) => raw.split(",").map((s) => s.trim());

  let only: Set<string> | null = null;
  if (values.only !== undefined) {
    const names = list(values.only);
    if (names.some((n) => n === "")) return { ok: false, error: "--only has an empty name" };
    const unknown = names.filter((n) => !known.names.has(n));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `Not a variable synced to ${known.destination ?? "Vercel"}: ${unknown.join(", ")} (check the name, and that your checkout is up to date)`,
      };
    }
    only = new Set(names);
  }

  let targets: Set<string> | null = null;
  if (values.target !== undefined) {
    const names = list(values.target);
    const unknown = names.filter((t) => !known.targets.includes(t));
    if (unknown.length > 0) {
      return { ok: false, error: `Unknown target: ${unknown.join(", ")} (expected ${known.targets.join(" or ")})` };
    }
    targets = new Set(names);
  }

  return { ok: true, only, targets };
}

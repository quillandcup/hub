// Fails when a migration would be rejected by `supabase db push` on main:
// a new migration numbered at or below the latest one already on the base branch,
// a duplicate version, or a file name that isn't `<14-digit version>_<name>.sql`.
// Run by the pre-commit hook and the unit CI job (pull requests only).
//
//   tsx scripts/check-migration-order.ts [baseRef]    (default: origin/main)
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";
const NAME_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/;

export function findMigrationProblems(baseFiles: string[], localFiles: string[]): string[] {
  const problems: string[] = [];
  const baseSet = new Set(baseFiles);
  const added = localFiles.filter((file) => !baseSet.has(file));

  for (const file of added) {
    if (!NAME_PATTERN.test(file)) {
      problems.push(`${file}: name must look like 20261122000000_describe_change.sql`);
    }
  }

  const byVersion = new Map<string, string[]>();
  for (const file of localFiles) {
    const version = file.match(NAME_PATTERN)?.[1];
    if (version) byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  for (const [version, files] of byVersion) {
    if (files.length > 1) {
      problems.push(`version ${version} is used by ${files.join(" and ")}; later ones are silently skipped`);
    }
  }

  const latestBase = baseFiles
    .map((file) => file.match(NAME_PATTERN)?.[1])
    .filter((version): version is string => Boolean(version))
    .sort()
    .at(-1);
  if (latestBase) {
    for (const file of added) {
      const version = file.match(NAME_PATTERN)?.[1];
      if (version && version <= latestBase) {
        problems.push(
          `${file}: version is not newer than ${latestBase}, the latest on the base branch; rename it with a newer timestamp`,
        );
      }
    }
  }
  return problems;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function main() {
  const baseRef = process.argv[2] ?? "origin/main";
  let baseFiles: string[];
  try {
    baseFiles = git("ls-tree", "--name-only", `${baseRef}:${MIGRATIONS_DIR}/`)
      .split("\n")
      .filter(Boolean);
  } catch {
    console.warn(`check-migration-order: ${baseRef} not available, skipping (git fetch origin main to enable)`);
    return;
  }

  const localFiles = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
  const problems = findMigrationProblems(baseFiles, localFiles);
  if (problems.length === 0) return;

  console.error(`❌ Migration problems (compared with ${baseRef}):`);
  for (const problem of problems) console.error(`   - ${problem}`);
  console.error("   `supabase db push` would reject these on main, after merge.");
  process.exit(1);
}

if (process.argv[1]?.endsWith("check-migration-order.ts")) main();

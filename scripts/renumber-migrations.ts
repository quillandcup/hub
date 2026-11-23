// Renumbers the migrations this branch adds when `pnpm check:migrations` says
// "version is not newer than <latest>": another PR landed a newer migration first.
//
//   tsx scripts/renumber-migrations.ts                       dry run (pnpm migrations:renumber)
//   tsx scripts/renumber-migrations.ts --apply               write the renames and reference updates
//   tsx scripts/renumber-migrations.ts --include-prs         also step past open PRs' and other worktrees' migrations
//   tsx scripts/renumber-migrations.ts [baseRef]             default origin/main (fetched first; --no-fetch skips)
//
// A file this branch adds (not on baseRef) whose version is at or below the newest on baseRef gets the
// next free version after it, in the same relative order, keeping the name part. A later file of the
// branch that would end up before a renamed one is renumbered too. Every other reference to the old
// version (tests, docs, rules, TODO, source) is updated: files git tracks or would track, never
// node_modules or .git.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listOpenPrs, MIGRATIONS_DIR, NAME_PATTERN } from "./check-migration-order";

export type Rename = { from: string; to: string; /** Replace the bare version too, not only the file name. */ bareVersion: boolean };

const MAX_TEXT_BYTES = 5_000_000;

const versionOf = (file: string) => file.match(NAME_PATTERN)?.[1];

/** The version one second later (versions are UTC timestamps), skipping any already taken. */
export function nextVersion(version: string, taken: Set<string>): string {
  const [, y, mo, d, h, mi, s] = version.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/) ?? [];
  let time = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  for (;;) {
    time += 1000;
    const next = new Date(time).toISOString().replace(/[-T:]/g, "").slice(0, 14);
    if (!taken.has(next)) return next;
  }
}

/**
 * Which of `localFiles` (not on the base) to rename, and to what. `otherFiles` are migrations from open
 * PRs and other worktrees that the new versions must also come after.
 */
export function planRenumber(baseFiles: string[], localFiles: string[], otherFiles: string[] = []): Rename[] {
  const baseSet = new Set(baseFiles);
  const added = localFiles
    .filter((file) => !baseSet.has(file) && NAME_PATTERN.test(file))
    .sort();
  const addedSet = new Set(added);
  const others = otherFiles.filter((file) => !addedSet.has(file));
  const floorVersions = [...baseFiles, ...others].map(versionOf).filter((v): v is string => Boolean(v));
  const floor = floorVersions.sort().at(-1);
  if (!floor) return [];

  const taken = new Set([...floorVersions, ...localFiles.map(versionOf).filter((v): v is string => Boolean(v))]);
  const sharedVersions = new Set(
    [...baseFiles, ...others].map(versionOf).filter((v): v is string => Boolean(v)),
  );
  const renames: Rename[] = [];
  let cursor = floor;
  for (const file of added) {
    const version = versionOf(file) as string;
    if (version > cursor) {
      cursor = version;
      continue;
    }
    const to = nextVersion(cursor, taken);
    taken.add(to);
    cursor = to;
    const usedByOtherFiles = sharedVersions.has(version) || added.some((f) => f !== file && versionOf(f) === version);
    renames.push({ from: file, to: file.replace(version, to), bareVersion: !usedByOtherFiles });
  }
  return renames;
}

/** `content` with the renamed versions replaced (whole numbers only, so a longer digit string is left alone). */
export function updateReferences(content: string, renames: Rename[]): string {
  let out = content;
  for (const { from, to, bareVersion } of renames) {
    const oldVersion = versionOf(from) as string;
    const newVersion = versionOf(to) as string;
    out = bareVersion
      ? out.replace(new RegExp(`(?<!\\d)${oldVersion}(?!\\d)`, "g"), newVersion)
      : out.replace(new RegExp(`(?<!\\d)${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), to);
  }
  return out;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function migrationFiles(dir: string): string[] {
  const full = path.join(dir, MIGRATIONS_DIR);
  return existsSync(full) ? readdirSync(full).filter((file) => file.endsWith(".sql")) : [];
}

/** Migration files in the repo's other worktrees. */
function worktreeMigrations(cwd: string): string[] {
  const self = path.resolve(cwd);
  return git(cwd, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((dir) => path.resolve(dir) !== self)
    .flatMap(migrationFiles);
}

export type Result = { renames: Rename[]; changedFiles: string[] };

export function renumber(options: { cwd: string; baseRef: string; apply: boolean; includeOthers?: boolean }): Result {
  const { cwd, baseRef, apply, includeOthers } = options;
  const baseFiles = git(cwd, "ls-tree", "--name-only", `${baseRef}:${MIGRATIONS_DIR}/`).split("\n").filter(Boolean);
  const localFiles = migrationFiles(cwd);
  let others: string[] = [];
  if (includeOthers) {
    others = [
      ...worktreeMigrations(cwd),
      ...listOpenPrs().flatMap((pr) => pr.migrations),
    ];
  }
  const renames = planRenumber(baseFiles, localFiles, others);
  if (renames.length === 0) return { renames, changedFiles: [] };

  const renamed = new Set(renames.map((r) => path.join(MIGRATIONS_DIR, r.from)));
  const changedFiles: string[] = [];
  const candidates = git(cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean);
  for (const file of candidates) {
    const full = path.join(cwd, file);
    if (!existsSync(full) || statSync(full).size > MAX_TEXT_BYTES) continue;
    const buffer = readFileSync(full);
    if (buffer.includes(0)) continue;
    const before = buffer.toString("utf8");
    const after = updateReferences(before, renames);
    if (after === before) continue;
    changedFiles.push(file);
    if (apply) writeFileSync(full, after);
  }
  if (apply) {
    for (const file of renamed) {
      const rename = renames.find((r) => path.join(MIGRATIONS_DIR, r.from) === file) as Rename;
      renameSync(path.join(cwd, file), path.join(cwd, MIGRATIONS_DIR, rename.to));
    }
  }
  return { renames, changedFiles };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const baseRef = args.find((arg) => !arg.startsWith("--")) ?? "origin/main";
  if (!args.includes("--no-fetch") && baseRef === "origin/main") {
    git(".", "fetch", "--no-tags", "origin", "main");
  }
  const { renames, changedFiles } = renumber({ cwd: ".", baseRef, apply, includeOthers: args.includes("--include-prs") });
  if (renames.length === 0) {
    console.log(`Nothing to renumber: every migration this branch adds is newer than the latest on ${baseRef}.`);
    return;
  }
  console.log(apply ? "Renamed:" : "Would rename (dry run, pass --apply to write):");
  for (const { from, to } of renames) console.log(`  ${from} -> ${to}`);
  if (changedFiles.length > 0) {
    console.log(apply ? "References updated in:" : "References that would be updated in:");
    for (const file of changedFiles) console.log(`  ${file}`);
  }
  if (apply) console.log("Now run `pnpm check:migrations`.");
}

if (process.argv[1]?.endsWith("renumber-migrations.ts")) main();

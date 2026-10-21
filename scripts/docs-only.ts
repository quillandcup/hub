// Tells whether a change touches documentation only, so CI (and the pre-commit build) can skip
// work that can't be affected. The answer comes from the files that changed, never from a
// commit message: a `[skip ci]` in a message is taken on trust, and a code change that carries
// one would sail past every check.
//
//   node scripts/docs-only.ts <baseRef>    files changed between baseRef and HEAD (CI)
//   node scripts/docs-only.ts --staged     files staged for commit (pre-commit hook)
//
// Prints `true` or `false`, and in CI also writes `docs_only=<value>` to $GITHUB_OUTPUT. It runs
// on bare Node (no `npm ci`), so it uses only node: imports and syntax Node can strip types from.
//
// It is an allowlist: every changed file must match. Anything unrecognised, an empty change, or a
// git failure answers `false`, i.e. run everything. If code ever reads one of these files at build
// or run time, move that file out of the allowlist.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const DOC_PATTERNS = [
  /\.md$/, // any markdown file, e.g. README.md next to a route
  /^docs\//, // the docs folder, including images and diagrams
  /^\.claude\/rules\/[^/]+\.mdc$/, // agent rules written as .mdc
];

export function isDocsOnly(files: string[]): boolean {
  return files.length > 0 && files.every((file) => DOC_PATTERNS.some((pattern) => pattern.test(file)));
}

function changedFiles(args: string[]): string[] {
  const output = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.split("\n").filter(Boolean);
}

function main() {
  const arg = process.argv[2];
  let files: string[] = [];
  try {
    if (arg === "--staged") files = changedFiles(["diff", "--cached", "--name-only"]);
    else if (arg) files = changedFiles(["diff", "--name-only", arg, "HEAD"]);
    else console.error("docs-only: pass a base ref or --staged");
  } catch (error) {
    console.error(`docs-only: couldn't list the changed files, treating as not docs-only (${error})`);
  }

  const docsOnly = isDocsOnly(files);
  console.error(`docs-only: ${files.length} changed file(s), docs only: ${docsOnly}`);
  for (const file of files.slice(0, 50)) console.error(`  ${file}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
  console.log(String(docsOnly));
}

if (process.argv[1]?.endsWith("docs-only.ts")) main();

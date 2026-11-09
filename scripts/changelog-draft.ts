import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDraftInput, buildDraftPrompt, type MergedPr } from "@/lib/changelog/draft";
import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";

/**
 * `pnpm changelog:draft [--since YYYY-MM-DD] [--run]`: collects the pull requests merged since that day (default: 14 days
 * ago) with `gh`, and writes demo/out/changelog-draft/prompt.md. With `--run` it also pipes the prompt to `claude -p`
 * (the Claude Code CLI, not a dependency of the app) and writes drafts.md next to it. Nothing is added to the changelog:
 * a person reviews the draft, runs the member reader review, takes the screenshots and writes the entries.
 * docs/CHANGELOG_PROCESS.md, "Drafting entries".
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function defaultSince(): string {
  return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function main() {
  const since = arg("since") ?? defaultSince();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since must be YYYY-MM-DD, got "${since}"`);

  const raw = execFileSync(
    "gh",
    ["pr", "list", "--state", "merged", "--base", "main", "--search", `merged:>=${since}`, "--limit", "500", "--json", "number,title,mergedAt,body,files"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const prs: MergedPr[] = (JSON.parse(raw) as (Omit<MergedPr, "files"> & { files: { path: string }[] })[]).map((pr) => ({
    ...pr,
    files: pr.files.map((f) => f.path),
  }));

  const input = buildDraftInput(since, prs, CHANGELOG_ENTRIES);
  const prompt = buildDraftPrompt(input);
  const dir = path.join("demo", "out", "changelog-draft");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "prompt.md"), prompt);
  console.log(`${prs.length} merged since ${since}; ${input.prs.length} could matter (the rest are docs, tests or changelog only).`);
  console.log(`Prompt: ${path.join(dir, "prompt.md")}`);

  if (process.argv.includes("--run")) {
    const drafts = execFileSync("claude", ["-p"], { input: prompt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(path.join(dir, "drafts.md"), drafts);
    console.log(`Drafts: ${path.join(dir, "drafts.md")}`);
  }
}

main();

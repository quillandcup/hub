import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDraftInput,
  buildGroupPrompt,
  buildStoryPrompt,
  parseGrouping,
  type MergedPr,
} from "@/lib/changelog/draft";
import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";
import { LIVE_FLAGS } from "@/lib/changelog/live-flags";
import { FEATURE_PREVIEWS } from "@/lib/features";

/**
 * `pnpm changelog:draft [--since YYYY-MM-DD] [--live-flags a,b] [--run]`: collects the pull requests merged since that day
 * (default: 2 days ago) and the production deployments from GitHub, and writes the titles-only grouping prompt to
 * demo/out/changelog-draft/. With `--run` it calls the Claude Code CLI (not a dependency of the app) twice: a small model
 * groups the pull requests into stories, then a larger one drafts only the member-visible stories into drafts.md. A pull
 * request that names a feature flag not in `LIVE_FLAGS` (lib/changelog/live-flags.ts, or `--live-flags`) is held back until
 * the flag is on for everyone. The job never reads the production database.
 * Nothing is added to the changelog: a person reviews the draft. docs/CHANGELOG_PROCESS.md, "Drafting entries".
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** One print-mode call with no tools and a single turn, so the CLI adds nothing but the prompt. */
function claude(model: string, prompt: string): string {
  return execFileSync("claude", ["-p", "--model", model, "--tools", "", "--max-turns", "1", "--no-session-persistence"], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main() {
  const since = arg("since") ?? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since must be YYYY-MM-DD, got "${since}"`);
  const liveFlags = [...LIVE_FLAGS, ...(arg("live-flags") ?? "").split(",").filter(Boolean)];

  const prs: MergedPr[] = (
    JSON.parse(
      gh(["pr", "list", "--state", "merged", "--base", "main", "--search", `merged:>=${since}`, "--limit", "500", "--json", "number,title,mergedAt,body,files"]),
    ) as (Omit<MergedPr, "files"> & { files: { path: string }[] })[]
  ).map((pr) => ({ ...pr, files: pr.files.map((f) => f.path) }));
  if (prs.length === 500) console.warn("Warning: 500 pull requests is the fetch limit; use a later --since.");

  const deployTimes = JSON.parse(gh(["api", "repos/{owner}/{repo}/deployments?environment=production&per_page=100", "--jq", "[.[].created_at]"])) as string[];
  const input = buildDraftInput(since, prs, CHANGELOG_ENTRIES, { flagKeys: FEATURE_PREVIEWS.map((f) => f.key), liveFlags, deployTimes });

  const dir = path.join("demo", "out", "changelog-draft");
  mkdirSync(dir, { recursive: true });
  const groupPrompt = buildGroupPrompt(input);
  writeFileSync(path.join(dir, "group-prompt.md"), groupPrompt);
  console.log(`${prs.length} merged since ${since}; ${input.prs.length} could matter, ${input.held.length} held back behind a flag.`);
  for (const h of input.held) console.log(`  held #${h.number} (${h.flags.join(", ")}): ${h.title}`);
  console.log(`Grouping prompt: ${Math.round(groupPrompt.length / 1024)} KB`);

  if (!process.argv.includes("--run")) return;

  const grouping = parseGrouping(claude("haiku", groupPrompt), new Set(input.prs.map((p) => p.number)));
  writeFileSync(path.join(dir, "grouping.json"), JSON.stringify(grouping, null, 2));
  console.log(`${grouping.stories.length} stories, ${grouping.engineering.length} engineering, ${grouping.skip.length} skipped.`);
  if (grouping.stories.length === 0) return;

  const rules = readFileSync(".claude/rules/changelog-writing.md", "utf8");
  const storyPrompt = buildStoryPrompt(grouping.stories, input, rules);
  writeFileSync(path.join(dir, "story-prompt.md"), storyPrompt);
  console.log(`Story prompt: ${Math.round(storyPrompt.length / 1024)} KB`);
  writeFileSync(path.join(dir, "drafts.md"), claude("sonnet", storyPrompt));
  console.log(`Drafts: ${path.join(dir, "drafts.md")}`);
}

main();

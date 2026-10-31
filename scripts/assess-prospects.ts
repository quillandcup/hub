/**
 * Asks Claude to read each unassessed prospect's profile and save a short assessment (fit, a
 * summary, a draft opener) for the reviewer on /admin/outreach/prospects. Advice only: nothing is
 * sent to anyone and no status changes.
 *
 * It runs the Claude Code CLI in headless mode (`claude -p`), so it uses the Claude subscription you
 * are logged in with on this machine, not an API key. That is meant for your own runs; see
 * docs/PROSPECTING.md before moving it to a server, where it would need an API key instead.
 *
 * Usage:
 *   npx tsx scripts/assess-prospects.ts [env-file] [--limit=20] [--criteria=<file>] [--apply]
 *
 * Without --apply it only prints the assessments. Writes use the service role, so point env-file at
 * the database you mean (default .env.local, the local one). Prospect bios are other people's
 * words: the CLI gets no tools, runs in an empty temp directory, and the prompt fences the profile.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { buildAssessmentPrompt, parseAssessment } from "../lib/prospecting/assessment";
import { createRepos } from "../lib/data/repos";
import type { Database } from "../lib/data/database.types";

const DEFAULT_CRITERIA =
  "People writing, or wanting to write, a book (fiction, memoir, poetry) who would benefit from a friendly community that writes together on video. " +
  "Not a fit: coaches, editors, ghostwriters, publishers and other people who sell to writers; promo and bot accounts.";
const CLAUDE_TIMEOUT_MS = 120_000;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20);
const criteriaFile = args.find((a) => a.startsWith("--criteria="))?.split("=")[1];
const envFile = args.find((a) => !a.startsWith("--")) ?? ".env.local";

function askClaude(prompt: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--disable-slash-commands"], {
      cwd: mkdtempSync(join(tmpdir(), "assess-prospects-")),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), CLAUDE_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(out);
      else reject(new Error(`claude exited with ${code}: ${err.trim().slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
}

async function main() {
  config({ path: resolve(envFile) });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in ${envFile}`);
  const repos = createRepos(createClient<Database>(url, key));
  const criteria = criteriaFile ? readFileSync(resolve(criteriaFile), "utf8") : DEFAULT_CRITERIA;

  const waiting = await repos.prospects.awaitingAssessment(limit);
  console.log(`${waiting.length} prospect(s) to assess (${apply ? "saving" : "dry run, pass --apply to save"}) against ${url}`);

  let saved = 0;
  for (const p of waiting) {
    try {
      const assessment = parseAssessment(await askClaude(buildAssessmentPrompt({ handle: p.handle, bio: p.bio, hashtags: p.hashtags, followerCount: p.followerCount }, criteria)));
      if (!assessment) {
        console.warn(`@${p.handle}: the answer was not in the expected shape, skipped`);
        continue;
      }
      console.log(`@${p.handle} (rules ${p.fitScore}): ${assessment.fit} - ${assessment.summary}`);
      if (apply) {
        await repos.prospects.saveAssessment(p.id, assessment, new Date());
        saved++;
      }
    } catch (error) {
      console.warn(`@${p.handle}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(apply ? `Saved ${saved} of ${waiting.length}.` : "Nothing saved (dry run).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

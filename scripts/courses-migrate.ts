/**
 * One command for the whole Kajabi course migration (docs/product/COURSES.md, "Migration pipeline"):
 *
 *   pnpm courses:migrate --course <kajabi-course-id> [--env .env.prod] [--base-url <url>] [--yes]
 *     [--access-duration "1 year"|lifetime] [--launch-on YYYY-MM-DD] [--skip-drafts]
 *
 * Runs steps A (structure), B (lesson content, opens Chrome), C (process, and publish a new course), then
 * D (downloads, images, videos), stopping at the first step that fails. Every step is safe to repeat, so a
 * run with nothing new is a no-op. The logic is in src/lib/courses/migrate.ts; this file only wires the real
 * terminal, fetch and the capture script into it.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { appConfig } from "../config/app";
import { formatSummary, resolveEnvironment, runMigration, type MigrateIO } from "../src/lib/courses/migrate";
import { MIGRATE_USAGE, parseMigrateArgs } from "../src/lib/courses/migrate-args";
import { loadLayeredEnv } from "./load-layered-env";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl.close();
  }
}

/** Runs the Kajabi capture (a Playwright script with its own saved login), showing its output as it goes and keeping a copy. */
function runContent(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", "scripts/kajabi-course-content.ts", ...args], { stdio: ["inherit", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main() {
  const args = parseMigrateArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(`${args.error}\n\n${MIGRATE_USAGE}`);
    process.exit(1);
  }
  let loaded;
  try {
    loaded = loadLayeredEnv(args.envFile);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const env = resolveEnvironment(args, { ...loaded.values, ...process.env }, appConfig.appUrl);
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }

  const io: MigrateIO = {
    fetch,
    confirm: async (question) => /^y(es)?$/i.test(await prompt(`${question} [y/N]`)),
    ask: prompt,
    runContent,
    log: (line) => console.log(line),
  };

  console.log(`Migrating Kajabi course ${args.courseId} into ${env.baseUrl} (env ${args.envFile}).`);
  const isLocal = new URL(env.baseUrl).hostname === "localhost";
  if (!isLocal && !args.yes && !(await io.confirm(`This writes to ${env.baseUrl}. Continue?`))) {
    console.log("Stopped. Nothing was changed.");
    return;
  }

  const result = await runMigration(args, env, io);
  for (const line of formatSummary(result)) console.log(line);
  // A declined question is a choice, not a failure.
  if (result.stopped?.kind === "failed" || result.failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

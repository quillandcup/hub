#!/usr/bin/env npx tsx
// Syncs app runtime env vars to Vercel, reading which vars go where from
// env-vars.config.ts at the repo root instead of a hardcoded list -- see that file for why.
//
// .env.devel -> Vercel Development + Preview
// .env.prod  -> Vercel Production

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import { ENV_VARS, type VercelTarget } from "../env-vars.config";

const SOURCE_FILE: Record<VercelTarget, string> = {
  development: ".env.devel",
  preview: ".env.devel",
  production: ".env.prod",
};

// This project has `vercel` pinned as a devDependency (used by other tooling), which is a
// much older CLI (no --type flag support) than the one this script needs. Running this
// script via `npx` from a directory with node_modules prepends that local node_modules/.bin
// onto PATH, silently shadowing the real global `vercel` install -- bit us in production on
// 2026-09-25 (a bare `spawnSync("vercel", ...)` resolved the local 56.x instead of the
// intended 59.x/60.x). Stripping node_modules/.bin PATH entries forces global resolution
// regardless of where/how this script is invoked from.
const GLOBAL_PATH = (process.env.PATH ?? "")
  .split(":")
  .filter((p) => !p.includes("node_modules"))
  .join(":");
const spawnEnv = { ...process.env, PATH: GLOBAL_PATH };

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    console.error(`❌ ${path} not found!`);
    process.exit(1);
  }
  return parseDotenv(readFileSync(path));
}

function run(args: string[]): boolean {
  const result = spawnSync("vercel", args, { stdio: "inherit", env: spawnEnv });
  return result.status === 0;
}

function syncOne(name: string, target: VercelTarget, value: string): void {
  console.log(`📤 Syncing ${name} to ${target}...`);
  // Ignore failure: fine if it didn't already exist.
  run(["env", "rm", name, target, "--yes"]);
  // Always --type config, never left to default (which is `secret`/`sensitive` as of
  // Vercel CLI 59+) -- see env-vars.config.ts's `vercel` destination doc comment for why
  // that default silently breaks NEXT_PUBLIC_* vars. `secret` values are still passed via
  // stdin, same as plain ones; `config` only controls whether Vercel can ever return the
  // value again, not how it's transmitted here.
  const target_arg = target === "preview" ? [name, target, ""] : [name, target];
  const add = spawnSync(
    "vercel",
    ["env", "add", ...target_arg, "--yes", "--type", "config"],
    {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
      env: spawnEnv,
    },
  );
  if (add.status !== 0) {
    console.error(`❌ Failed to add ${name} to ${target}`);
    process.exit(1);
  }
}

function parseArgs(): {
  only: Set<string> | null;
  targets: Set<VercelTarget> | null;
} {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const targetArg = process.argv.find((a) => a.startsWith("--target="));
  return {
    only: onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null,
    targets: targetArg
      ? new Set(
          targetArg.slice("--target=".length).split(",") as VercelTarget[],
        )
      : null,
  };
}

function main(): void {
  const { only, targets } = parseArgs();
  console.log(
    only
      ? `🚀 Syncing ${[...only].join(", ")} to Vercel${targets ? ` (${[...targets].join(", ")})` : ""}...\n`
      : "🚀 Syncing environment variables to Vercel...\n",
  );

  const devel = loadEnvFile(".env.devel");
  const prod = loadEnvFile(".env.prod");

  const missing: string[] = [];

  for (const spec of ENV_VARS) {
    if (only && !only.has(spec.name)) continue;
    for (const dest of spec.destinations) {
      if (dest.kind !== "vercel") continue;
      if (targets && !targets.has(dest.target)) continue;
      const source = dest.target === "production" ? prod : devel;
      const sourceFile = SOURCE_FILE[dest.target];
      const value = source[spec.name];
      if (value === undefined || value === "") {
        console.warn(
          `⚠️  ${spec.name} not found in ${sourceFile}, skipping ${dest.target}...`,
        );
        missing.push(
          `${spec.name} (${dest.target}, expected in ${sourceFile})`,
        );
        continue;
      }
      syncOne(spec.name, dest.target, value);
    }
  }

  console.log(
    "\nNote: CRON_INTERNAL_SECRET also needs to exist in Supabase Vault (pg_cron reads it",
  );
  console.log(
    "from there, not from Vercel) -- run scripts/sync-vault-secrets.ts after this.\n",
  );

  if (missing.length > 0) {
    console.error(
      "❌ Missing values (declared in env-vars.config.ts but absent from their source file):",
    );
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log("✅ Environment variables synced to Vercel!\n");
  console.log("Next steps:");
  console.log("  1. Verify: vercel env ls");
  console.log(
    "  2. Redeploy to apply: git push (for production) or create a PR (for preview)\n",
  );
}

main();

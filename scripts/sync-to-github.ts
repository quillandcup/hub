#!/usr/bin/env npx tsx 
// Syncs GitHub Actions secrets/variables from .env.prod for this repo's CI workflows,
// reading which vars go where from env-vars.config.ts at the repo root instead of a
// hardcoded list -- see that file for why. Counterpart to sync-to-vercel.ts, but GitHub
// Actions has no per-environment split like Vercel's prod/preview/dev -- everything here
// comes from .env.prod since these are ops/CI credentials, not app runtime vars.

import { spawnSync } from "node:child_process";
import { loadTargetEnv, sourceFilesFor } from "./env-files";
import { ENV_VARS } from "../env-vars.config";
import { GITHUB_SYNC_USAGE, parseSyncArgs } from "./sync-args";

const REPO = "quillandcup/hub";
// Production's values: .env.shared overridden by .env.prod.
const ENV_FILE = sourceFilesFor("production");

// A mistyped scoping flag must not quietly sync everything, so unknown arguments stop the run.
function parseOnly(): Set<string> | null {
  const names = new Set(
    ENV_VARS.filter((spec) => spec.destinations.some((d) => d.kind === "github" || d.kind === "github-dependabot")).map(
      (spec) => spec.name,
    ),
  );
  const parsed = parseSyncArgs(process.argv.slice(2), { names, targets: [], destination: "GitHub" });
  if (!parsed.ok) {
    console.error(`${parsed.error}\n\n${GITHUB_SYNC_USAGE}`);
    process.exit(2);
  }
  return parsed.only;
}

function main(): void {
  const only = parseOnly();
  console.log(`🚀 Syncing GitHub Actions secrets/variables for ${REPO}...\n`);

  const env = loadTargetEnv("production");

  const missing: string[] = [];

  for (const spec of ENV_VARS) {
    if (only && !only.has(spec.name)) continue;
    for (const dest of spec.destinations) {
      if (dest.kind !== "github" && dest.kind !== "github-dependabot") continue;
      const value = env[spec.name];
      if (value === undefined || value === "") {
        console.warn(`⚠️  ${spec.name} not found in ${ENV_FILE}, skipping...`);
        missing.push(spec.name);
        continue;
      }
      if (dest.kind === "github-dependabot" && spec.type !== "secret") {
        console.error(`❌ ${spec.name}: only secrets can go to Dependabot`);
        process.exit(1);
      }
      const dependabot = dest.kind === "github-dependabot";
      const label = spec.type === "secret" ? `🔒 ${dependabot ? "dependabot " : ""}secret` : "📤 variable";
      console.log(`${label} ${spec.name}...`);
      const cmd = spec.type === "secret" ? "secret" : "variable";
      const args = [cmd, "set", spec.name, "--repo", REPO, ...(dependabot ? ["--app", "dependabot"] : [])];
      const result = spawnSync("gh", args, {
        input: value,
        stdio: ["pipe", "inherit", "inherit"],
      });
      if (result.status !== 0) {
        console.error(`❌ Failed to sync ${spec.name}`);
        process.exit(1);
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      "❌ Missing values (declared in env-vars.config.ts but absent from .env.prod):",
    );
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log("\n✅ GitHub Actions secrets/variables synced!\n");
  console.log("Next steps:");
  console.log(
    `  1. Verify: gh secret list --repo ${REPO} / gh variable list --repo ${REPO}`,
  );
  console.log(
    `  2. Confirm with a run: gh workflow run ci.yml --ref main --repo ${REPO} (Supabase, Vercel, Slack) and gh workflow run checkly.yml --ref main --repo ${REPO} (Checkly)\n`,
  );
}

main();

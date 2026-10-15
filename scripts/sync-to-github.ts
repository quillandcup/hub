#!/usr/bin/env npx tsx 
// Syncs GitHub Actions secrets/variables from .env.prod for this repo's CI workflows,
// reading which vars go where from env-vars.config.ts at the repo root instead of a
// hardcoded list -- see that file for why. Counterpart to sync-to-vercel.ts, but GitHub
// Actions has no per-environment split like Vercel's prod/preview/dev -- everything here
// comes from .env.prod since these are ops/CI credentials, not app runtime vars.

import { spawnSync } from "node:child_process";
import { loadTargetEnv, sourceFilesFor } from "./env-files";
import { ENV_VARS } from "../env-vars.config";

const REPO = "quillandcup/hub";
// Production's values: .env.shared overridden by .env.prod.
const ENV_FILE = sourceFilesFor("production");

function main(): void {
  console.log(`🚀 Syncing GitHub Actions secrets/variables for ${REPO}...\n`);

  const env = loadTargetEnv("production");

  const missing: string[] = [];

  for (const spec of ENV_VARS) {
    for (const dest of spec.destinations) {
      if (dest.kind !== "github") continue;
      const value = env[spec.name];
      if (value === undefined || value === "") {
        console.warn(`⚠️  ${spec.name} not found in ${ENV_FILE}, skipping...`);
        missing.push(spec.name);
        continue;
      }
      const label = spec.type === "secret" ? "🔒 secret" : "📤 variable";
      console.log(`${label} ${spec.name}...`);
      const cmd = spec.type === "secret" ? "secret" : "variable";
      const result = spawnSync("gh", [cmd, "set", spec.name, "--repo", REPO], {
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

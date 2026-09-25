#!/usr/bin/env npx tsx 
// Syncs GitHub Actions secrets/variables from .env.prod for this repo's CI workflows,
// reading which vars go where from env-vars.config.ts at the repo root instead of a
// hardcoded list -- see that file for why. Counterpart to sync-to-vercel.ts, but GitHub
// Actions has no per-environment split like Vercel's prod/preview/dev -- everything here
// comes from .env.prod since these are ops/CI credentials, not app runtime vars.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import { ENV_VARS } from "../env-vars.config";

const REPO = "quillandcup/hub";
const ENV_FILE = ".env.prod";

function main(): void {
  console.log(`🚀 Syncing GitHub Actions secrets/variables for ${REPO}...\n`);

  if (!existsSync(ENV_FILE)) {
    console.error(`❌ ${ENV_FILE} not found!`);
    process.exit(1);
  }
  const env = parseDotenv(readFileSync(ENV_FILE));

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
      const label = dest.type === "secret" ? "🔒 secret" : "📤 variable";
      console.log(`${label} ${spec.name}...`);
      const cmd = dest.type === "secret" ? "secret" : "variable";
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
    `  2. Trigger a workflow run to confirm: gh workflow run checkly.yml --repo ${REPO}\n`,
  );
}

main();

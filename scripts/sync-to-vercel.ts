#!/usr/bin/env npx tsx
// Syncs app runtime env vars to Vercel, reading which vars go where from
// env-vars.config.ts at the repo root instead of a hardcoded list -- see that file for why.
//
// .env.devel -> Vercel Development + Preview
// .env.prod  -> Vercel Production

import { existsSync, readFileSync } from "node:fs";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import { ENV_VARS, type EnvVarSpec, type VercelTarget } from "../env-vars.config";

const SOURCE_FILE: Record<VercelTarget, string> = {
  development: ".env.devel",
  preview: ".env.devel",
  production: ".env.prod",
};

// Runs the project's `vercel` devDependency via npx, so no global install is needed. It must
// be v59+ for `env add --type` (older CLIs reject the flag), which package.json guarantees.
function vercel(args: string[], options: SpawnSyncOptions) {
  return spawnSync("npx", ["vercel", ...args], options);
}

const TARGETS: readonly VercelTarget[] = ["development", "preview", "production"];
const SHORT: Record<VercelTarget, string> = { development: "dev", preview: "preview", production: "prod" };

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    console.error(`✗ ${path} not found`);
    process.exit(1);
  }
  return parseDotenv(readFileSync(path));
}

// The CLI's own output (banners, per-var warnings, "Added" tables) is captured and only
// shown if a command fails.
function syncOne(spec: EnvVarSpec, target: VercelTarget, value: string): void {
  const { name, type } = spec;
  // Ignore failure: fine if it didn't already exist.
  vercel(["env", "rm", name, target, "--yes"], { stdio: "pipe" });
  // Always pass --type explicitly rather than taking the CLI default, which is secret for
  // production/preview since CLI 59 -- see `type` in env-vars.config.ts for why a secret
  // NEXT_PUBLIC_* var breaks the build. Both types pass the value via stdin.
  const target_arg = target === "preview" ? [name, target, ""] : [name, target];
  const add = vercel(["env", "add", ...target_arg, "--yes", "--type", type], {
    input: value,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (add.status !== 0) {
    console.log(" ✗\n");
    console.error(`Failed to add ${name} to ${target}:\n${add.stdout ?? ""}${add.stderr ?? ""}`);
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
  const devel = loadEnvFile(".env.devel");
  const prod = loadEnvFile(".env.prod");

  const specs = ENV_VARS.filter(
    (spec) =>
      (!only || only.has(spec.name)) &&
      spec.destinations.some((d) => d.kind === "vercel" && (!targets || targets.has(d.target))),
  );
  const width = Math.max(...specs.map((s) => s.name.length));
  const scope = targets ? [...targets].map((t) => SHORT[t]).join(", ") : "all environments";
  console.log(`Syncing ${specs.length} vars to Vercel (${scope})\n`);

  let synced = 0;
  // Var name -> targets skipped because the source file has no value.
  const missing = new Map<string, VercelTarget[]>();
  const syncedNames = new Set<string>();

  for (const spec of specs) {
    const specTargets = TARGETS.filter((t) =>
      spec.destinations.some((d) => d.kind === "vercel" && d.target === t) && (!targets || targets.has(t)),
    );
    process.stdout.write(`  ${spec.name.padEnd(width)}  ${spec.type.padEnd(6)} `);
    for (const target of specTargets) {
      const value = (target === "production" ? prod : devel)[spec.name];
      if (value === undefined || value === "") {
        missing.set(spec.name, [...(missing.get(spec.name) ?? []), target]);
        process.stdout.write(` ${SHORT[target]} –`);
        continue;
      }
      process.stdout.write(` ${SHORT[target]}`);
      syncOne(spec, target, value);
      process.stdout.write(" ✓");
      synced++;
      syncedNames.add(spec.name);
    }
    process.stdout.write("\n");
  }

  console.log(`\n✓ ${synced} synced` + (missing.size ? `, ${[...missing.values()].flat().length} skipped (– above: no value in the source file)` : ""));
  for (const [name, skipped] of missing) {
    const files = [...new Set(skipped.map((t) => SOURCE_FILE[t]))].join(", ");
    console.log(`    ${name.padEnd(width)}  missing from ${files}`);
  }

  console.log("\nNext: redeploy for the new values to take effect.");
  if (syncedNames.has("CRON_INTERNAL_SECRET") && (!targets || targets.has("production"))) {
    console.log("      CRON_INTERNAL_SECRET was synced -- also run `npm run env:sync:vault` (pg_cron reads it from Supabase Vault).");
  }

  if (missing.size > 0) process.exit(1);
}

main();

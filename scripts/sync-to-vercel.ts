#!/usr/bin/env npx tsx
// Syncs app runtime env vars to Vercel, reading which vars go where from
// env-vars.config.ts at the repo root instead of a hardcoded list -- see that file for why.
//
// .env.shared + .env.preview -> Vercel Preview
// .env.shared + .env.prod    -> Vercel Production   (see scripts/env-files.ts)

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { ENV_VARS, type EnvVarSpec, type VercelTarget } from "../env-vars.config";
import { loadTargetEnv, sourceFilesFor } from "./env-files";
import { parseSyncArgs, SYNC_USAGE } from "./sync-args";

// Runs the project's `vercel` devDependency via npx, so no global install is needed. It must
// be v59+ for `env add --type` (older CLIs reject the flag), which package.json guarantees.
function vercel(args: string[], options: SpawnSyncOptions) {
  return spawnSync("npx", ["vercel", ...args], options);
}

const TARGETS: readonly VercelTarget[] = ["preview", "production"];
const SHORT: Record<VercelTarget, string> = { preview: "preview", production: "prod" };

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

/** URL of the newest ready preview deployment, for a copy-pasteable redeploy command. */
function latestPreviewUrl(): string | null {
  const res = vercel(["list", "--environment", "preview", "--status", "READY", "--format", "json", "--limit", "1"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  try {
    const parsed = JSON.parse(String(res.stdout));
    const url: string | undefined = (parsed.deployments ?? parsed)[0]?.url;
    return url ? `https://${url.replace(/^https?:\/\//, "")}` : null;
  } catch {
    return null;
  }
}

// A mistyped scoping flag must not quietly sync everything (it once did: `--only NAME` with a space
// matched nothing and re-synced all 46 variables), so unknown or malformed arguments stop the run.
function parseArgs(): {
  only: Set<string> | null;
  targets: Set<VercelTarget> | null;
} {
  const names = new Set(
    ENV_VARS.filter((spec) => spec.destinations.some((d) => d.kind === "vercel")).map((spec) => spec.name),
  );
  const parsed = parseSyncArgs(process.argv.slice(2), { names, targets: TARGETS });
  if (!parsed.ok) {
    console.error(`${parsed.error}\n\n${SYNC_USAGE}`);
    process.exit(2);
  }
  return { only: parsed.only, targets: parsed.targets as Set<VercelTarget> | null };
}

function main(): void {
  const { only, targets } = parseArgs();
  const envFor: Record<VercelTarget, Record<string, string>> = {
    preview: loadTargetEnv("preview"),
    production: loadTargetEnv("production"),
  };

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
  const syncedTargets = new Set<VercelTarget>();

  for (const spec of specs) {
    const specTargets = TARGETS.filter((t) =>
      spec.destinations.some((d) => d.kind === "vercel" && d.target === t) && (!targets || targets.has(t)),
    );
    process.stdout.write(`  ${spec.name.padEnd(width)}  ${spec.type.padEnd(6)} `);
    for (const target of specTargets) {
      const value = envFor[target][spec.name];
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
      syncedTargets.add(target);
    }
    process.stdout.write("\n");
  }

  console.log(`\n✓ ${synced} synced` + (missing.size ? `, ${[...missing.values()].flat().length} skipped (– above: no value in the env files)` : ""));
  for (const [name, skipped] of missing) {
    const files = [...new Set(skipped.map((t) => sourceFilesFor(t)))].join("; ");
    console.log(`    ${name.padEnd(width)}  missing from ${files}`);
  }

  // Deployments snapshot env vars when they're created, so changes need a redeploy.
  const next: string[] = [];
  if (syncedTargets.has("production")) {
    // CI runs tests + migrations, then builds and deploys (see ci.yml's workflow_dispatch).
    next.push("prod     gh workflow run ci.yml --ref main");
  }
  if (syncedTargets.has("preview")) {
    const url = latestPreviewUrl();
    next.push(url ? `preview  npx vercel redeploy ${url}` : "preview  push to the PR branch to rebuild its preview");
  }
  if (syncedNames.has("CRON_INTERNAL_SECRET") && syncedTargets.has("production")) {
    next.push("vault    pnpm env:sync:vault   # pg_cron reads CRON_INTERNAL_SECRET from Supabase Vault");
  }
  if (next.length) console.log(`\nRedeploy to apply:\n${next.map((l) => `  ${l}`).join("\n")}`);

  if (missing.size > 0) process.exit(1);
}

main();

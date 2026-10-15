#!/usr/bin/env npx tsx
// Diffs or pushes github-repo-config.yml against the live repository, so branch rules are
// reviewed in git instead of clicked in Settings.
//
//   tsx scripts/github-config.ts diff   show what a push would change (read-only)
//   tsx scripts/github-config.ts push   create or update the declared rulesets
//
// Only the rulesets the file declares are managed, matched by name; others are left alone. A
// push replaces a declared ruleset's settings wholesale. Runs through the `gh` CLI, so it needs
// `gh auth login` as a repo admin (GITHUB_TOKEN in Actions can't manage rulesets). The repo
// comes from GITHUB_REPOSITORY, else the current checkout's remote.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const CONFIG_FILE = "github-repo-config.yml";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Ruleset = { name: string; [key: string]: Json };

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function gh(args: string[], input?: string): string {
  const res = spawnSync("gh", args, { encoding: "utf8", input });
  if (res.status !== 0) fail(`gh ${args.join(" ")}: ${res.stderr.trim()}`);
  return res.stdout;
}

function repoName(): string {
  return process.env.GITHUB_REPOSITORY || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
}

function declared(): Ruleset[] {
  const raw = parseYaml(readFileSync(CONFIG_FILE, "utf8")) as { rulesets?: Ruleset[] } | null;
  if (!Array.isArray(raw?.rulesets) || raw.rulesets.some((r) => typeof r?.name !== "string")) {
    fail(`${CONFIG_FILE}: rulesets must be a list of objects with a name`);
  }
  return raw.rulesets;
}

const identity = (v: Json): string =>
  v && typeof v === "object" && !Array.isArray(v) ? String(v.type ?? v.context ?? v.actor_id ?? "") : JSON.stringify(v);

/**
 * The live value cut down to the keys the config declares, so server-added fields don't diff.
 * List items are matched to the declared item with the same type/context/actor_id; one the file
 * doesn't declare is kept whole, so it shows up as a difference.
 */
function project(live: Json | undefined, shape: Json): Json {
  if (Array.isArray(shape)) {
    const items = Array.isArray(live) ? live : [];
    return items.map((item) => {
      const match = shape.find((s) => identity(s) === identity(item));
      return match === undefined ? item : project(item, match);
    });
  }
  if (shape && typeof shape === "object") {
    const obj = live && typeof live === "object" && !Array.isArray(live) ? live : {};
    return Object.fromEntries(Object.keys(shape).map((k) => [k, project(obj[k], shape[k])]));
  }
  return live ?? null;
}

/** Order-insensitive: rules by type and checks by context, which GitHub may return reordered. */
function canonical(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => identity(a).localeCompare(identity(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== "diff" && mode !== "push") fail("usage: github-config.ts diff|push");
  const repo = repoName();
  const live = JSON.parse(gh(["api", `repos/${repo}/rulesets`, "--paginate"])) as { id: number; name: string }[];
  let changes = 0;

  for (const want of declared()) {
    const existing = live.find((r) => r.name === want.name);
    if (!existing) {
      changes++;
      console.log(`+ ${want.name}: not on ${repo} yet`);
      if (mode === "push") gh(["api", "-X", "POST", `repos/${repo}/rulesets`, "--input", "-"], JSON.stringify(want));
      continue;
    }
    const full = JSON.parse(gh(["api", `repos/${repo}/rulesets/${existing.id}`])) as Json;
    const have = JSON.stringify(canonical(project(full, want)), null, 2);
    const need = JSON.stringify(canonical(want), null, 2);
    if (have === need) {
      console.log(`= ${want.name}: up to date`);
      continue;
    }
    changes++;
    console.log(`~ ${want.name}: differs\n--- live\n${have}\n--- ${CONFIG_FILE}\n${need}`);
    if (mode === "push") gh(["api", "-X", "PUT", `repos/${repo}/rulesets/${existing.id}`, "--input", "-"], JSON.stringify(want));
  }

  console.log(changes === 0 ? "No changes." : mode === "push" ? `Applied ${changes} change(s) to ${repo}.` : `${changes} change(s) to apply (run push).`);
}

main();

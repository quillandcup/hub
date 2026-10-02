#!/usr/bin/env npx tsx
// Diffs or pushes slack-app-manifest.yml against the live Slack app (Billie Bot), so the
// manifest in the repo is the source of truth instead of a file someone remembers to paste
// into api.slack.com. CI runs `push` after every production deploy (ci.yml,
// push-slack-manifest job); `npm run slack:manifest:diff` is the read-only preview.
//
//   tsx scripts/slack-manifest.ts diff   show what a push would change (read-only)
//   tsx scripts/slack-manifest.ts push   replace the live app's configuration
//
// apps.manifest.update REPLACES the whole configuration: anything set in the Slack dashboard
// but missing from the manifest is removed. Change the manifest, not the dashboard.
//
// Auth is a Slack app configuration token (api.slack.com/apps -> "Your App Configuration
// Tokens"), which is per user + workspace and expires after 12 hours. Two ways to supply one:
//   SLACK_CONFIG_TOKEN          an access token, used as-is. For local runs.
//   SLACK_CONFIG_REFRESH_TOKEN  rotated into a fresh access token on every run. Rotating
//                               also issues a NEW refresh token, so this path writes it back
//                               to the GitHub secret (needs GH_TOKEN with secrets write and
//                               GITHUB_REPOSITORY) before doing anything else. For CI.
// SLACK_APP_ID (the A... id) is required either way.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const MANIFEST_FILE = "slack-app-manifest.yml";
const REFRESH_TOKEN_SECRET = "SLACK_CONFIG_REFRESH_TOKEN";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface SlackResponse {
  ok: boolean;
  error?: string;
  errors?: { message: string; pointer: string }[];
  [key: string]: unknown;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

async function slack(
  method: string,
  params: Record<string, string>,
  token?: string,
): Promise<SlackResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok) fail(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as SlackResponse;
  if (!body.ok) {
    const details = (body.errors ?? []).map((e) => `\n    ${e.pointer}: ${e.message}`).join("");
    fail(`${method}: ${body.error}${details}`);
  }
  return body;
}

/**
 * Trades the stored refresh token for an access token. The old refresh token is spent the
 * moment this succeeds, so the new one is saved to the GitHub secret straight away; if that
 * save fails the next run has no valid token and someone has to seed a new one by hand.
 */
async function rotateConfigToken(): Promise<string> {
  const refreshToken = requireEnv(REFRESH_TOKEN_SECRET);
  const repo = requireEnv("GITHUB_REPOSITORY");
  requireEnv("GH_TOKEN");

  const rotated = await slack("tooling.tokens.rotate", { refresh_token: refreshToken });
  const saved = spawnSync("gh", ["secret", "set", REFRESH_TOKEN_SECRET, "--repo", repo], {
    input: rotated.refresh_token as string,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (saved.status !== 0) {
    fail(
      `Rotated the Slack config token but could not save the new refresh token to the ${REFRESH_TOKEN_SECRET} secret. ` +
        "The stored one is now spent: generate a new token pair in Slack and re-seed the secret (docs/SLACK_MANIFEST.md).",
    );
  }
  return rotated.token as string;
}

/** Flattens a manifest to path -> value. Lists of scalars compare as sets (order is noise). */
function flatten(value: Json, path: string, out: Map<string, string>): Map<string, string> {
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) {
      out.set(path, JSON.stringify([...value].sort()));
    } else {
      value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
    }
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out.set(path, JSON.stringify(value));
  }
  return out;
}

/** Prints the differences and returns how many there are. */
function printDiff(live: Json, local: Json): number {
  const before = flatten(live, "", new Map());
  const after = flatten(local, "", new Map());
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  let changes = 0;
  for (const path of paths) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === b) continue;
    changes++;
    if (a === undefined) console.log(`+ ${path}: ${b}`);
    else if (b === undefined) console.log(`- ${path}: ${a}   (live only: a push removes it)`);
    else console.log(`~ ${path}: ${a} -> ${b}`);
  }
  if (changes === 0) console.log("No differences.");
  return changes;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "diff" && mode !== "push") fail("usage: slack-manifest.ts diff|push");

  const appId = requireEnv("SLACK_APP_ID");
  const local = parseYaml(readFileSync(MANIFEST_FILE, "utf8")) as Json;
  const token = process.env.SLACK_CONFIG_TOKEN || (await rotateConfigToken());

  const exported = await slack("apps.manifest.export", { app_id: appId }, token);
  console.log(`${MANIFEST_FILE} vs the live Slack app:`);
  const changes = printDiff(exported.manifest as Json, local);
  if (mode === "diff" || changes === 0) return;

  const updated = await slack(
    "apps.manifest.update",
    { app_id: appId, manifest: JSON.stringify(local) },
    token,
  );
  console.log("✓ Slack app manifest updated");
  if (updated.permissions_updated) {
    // GitHub Actions renders this as a warning annotation on the run.
    console.log(
      "::warning::Slack app scopes changed. Reinstall the app to the workspace for the new scopes to take effect.",
    );
  }
}

main();

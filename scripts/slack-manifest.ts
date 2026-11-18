#!/usr/bin/env npx tsx
// Diffs, pushes or creates Slack app manifests, so the manifests in the repo are the source of
// truth instead of files someone remembers to paste into api.slack.com. Two apps are managed:
//   billie  slack-app-manifest.yml         Billie Bot, the Hub's Slack app (id in SLACK_APP_ID)
//   alerts  slack-alerts-app-manifest.yml  a minimal incoming-webhook app that posts to #hub-alerts
//                                          (id in SLACK_ALERTS_APP_ID)
// CI runs `push` after every production deploy (ci.yml, push-slack-manifest job);
// `pnpm slack:manifest:diff` is the read-only preview.
//
//   tsx scripts/slack-manifest.ts diff [apps]    show what a push would change (read-only)
//   tsx scripts/slack-manifest.ts push [apps]    replace the live apps' configuration
//   tsx scripts/slack-manifest.ts create alerts  create the alerts app ONCE and print its id
//
// [apps] is billie (the default), alerts, or a comma-separated list such as billie,alerts.
// A list shares ONE token rotation, which matters in CI: every rotation spends the refresh token.
//
// apps.manifest.update REPLACES the whole configuration: anything set in the Slack dashboard
// but missing from the manifest is removed. Change the manifest, not the dashboard.
//
// Auth is a Slack app configuration token (api.slack.com/apps -> "Your App Configuration
// Tokens"), which is per user + workspace and expires after 12 hours. Two ways to supply one:
//   SLACK_CONFIG_TOKEN          an access token, used as-is. For local runs; `create` needs it.
//   SLACK_CONFIG_REFRESH_TOKEN  rotated into a fresh access token on every run. Rotating
//                               also issues a NEW refresh token, so this path writes it back
//                               to the GitHub secret (needs GH_TOKEN with secrets write and
//                               GITHUB_REPOSITORY) before doing anything else. For CI.
// The app's A... id is required for diff and push (the env var named above).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { outboundFetch } from "@/lib/http/outbound";

export interface SlackApp {
  manifestFile: string;
  /** Env var holding the app's A... id. */
  appIdEnv: string;
}

export const APPS = {
  billie: { manifestFile: "slack-app-manifest.yml", appIdEnv: "SLACK_APP_ID" },
  alerts: { manifestFile: "slack-alerts-app-manifest.yml", appIdEnv: "SLACK_ALERTS_APP_ID" },
} as const satisfies Record<string, SlackApp>;

export type AppName = keyof typeof APPS;
export type Mode = "diff" | "push" | "create";

const REFRESH_TOKEN_SECRET = "SLACK_CONFIG_REFRESH_TOKEN";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface SlackResponse {
  ok: boolean;
  error?: string;
  errors?: { message: string; pointer: string }[];
  [key: string]: unknown;
}

export function fail(message: string): never {
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
  const res = await outboundFetch(`https://slack.com/api/${method}`, {
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
export function flatten(value: Json, path: string, out: Map<string, string>): Map<string, string> {
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
export function printDiff(live: Json, local: Json): number {
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

/** Reads `<mode> [apps]` from argv; no apps means billie, so the original CLI is unchanged. */
export function parseArgs(argv: string[]): { mode: Mode; apps: AppName[] } {
  const [mode, list = "billie"] = argv;
  if (mode !== "diff" && mode !== "push" && mode !== "create") {
    fail("usage: slack-manifest.ts diff|push [billie|alerts|billie,alerts] | create alerts");
  }
  const apps: AppName[] = [];
  for (const name of list.split(",")) {
    if (!(name in APPS)) fail(`unknown app "${name}" (expected ${Object.keys(APPS).join(" or ")})`);
    if (!apps.includes(name as AppName)) apps.push(name as AppName);
  }
  if (mode === "create" && (apps.length !== 1 || apps[0] !== "alerts")) {
    fail("create is only for the alerts app (Billie Bot already exists): slack-manifest.ts create alerts");
  }
  return { mode, apps };
}

/**
 * Creates the app from its manifest and prints its id. The response also carries the app's
 * credentials (client secret, signing secret): none of that is printed.
 */
async function createApp(name: AppName, token: string): Promise<void> {
  const { manifestFile, appIdEnv } = APPS[name];
  const manifest = parseYaml(readFileSync(manifestFile, "utf8")) as Json;
  const created = await slack("apps.manifest.create", { manifest: JSON.stringify(manifest) }, token);
  console.log(`✓ Created the Slack app from ${manifestFile}`);
  console.log(`App id: ${created.app_id}`);
  console.log(`Next: set it as the ${appIdEnv} GitHub variable (docs/SLACK_MANIFEST.md).`);
}

async function syncApp(name: AppName, mode: "diff" | "push", token: string): Promise<void> {
  const { manifestFile, appIdEnv } = APPS[name];
  const appId = requireEnv(appIdEnv);
  const local = parseYaml(readFileSync(manifestFile, "utf8")) as Json;

  const exported = await slack("apps.manifest.export", { app_id: appId }, token);
  console.log(`${manifestFile} vs the live Slack app:`);
  const changes = printDiff(exported.manifest as Json, local);
  if (mode === "diff" || changes === 0) return;

  const updated = await slack(
    "apps.manifest.update",
    { app_id: appId, manifest: JSON.stringify(local) },
    token,
  );
  console.log(`✓ Slack app manifest updated (${manifestFile})`);
  if (updated.permissions_updated) {
    // GitHub Actions renders this as a warning annotation on the run.
    console.log(
      `::warning::Slack app scopes changed (${manifestFile}). Reinstall the app to the workspace for the new scopes to take effect.`,
    );
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { mode, apps } = parseArgs(argv);

  if (mode === "create") {
    // Never rotate here: creating is a one-off local step, and a rotation would spend CI's token.
    await createApp(apps[0], requireEnv("SLACK_CONFIG_TOKEN"));
    return;
  }

  // Fail on a missing app id before rotating, so a typo doesn't spend the refresh token.
  for (const name of apps) requireEnv(APPS[name].appIdEnv);
  // One token for every app in this run: each rotation spends the refresh token.
  const token = process.env.SLACK_CONFIG_TOKEN || (await rotateConfigToken());
  for (const name of apps) await syncApp(name, mode, token);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();

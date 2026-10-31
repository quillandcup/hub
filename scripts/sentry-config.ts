#!/usr/bin/env npx tsx
// Diffs or pushes sentry-config.yml against the live Sentry organization, so the data-scrubbing settings are
// reviewed in git instead of clicked in the dashboard. CI runs `push` after every production deploy that changed
// the file or this script (ci.yml, push-sentry-config job); `pnpm sentry:config:diff` is the read-only preview.
//
//   tsx scripts/sentry-config.ts diff   show what a push would change (read-only)
//   tsx scripts/sentry-config.ts push   apply the file to the live organization
//
// Only the settings the file lists are written (PUT /api/0/organizations/<org>/ with just those keys).
//
// Env: SENTRY_CONFIG_TOKEN, an internal integration token with Organization: Read & Write. It is not the
// build token SENTRY_AUTH_TOKEN, which can upload source maps but cannot read organization settings.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import appConfig from "../app.config";
import { orgSettingsBody, parseSentryConfig, planOrgSettings, type OrgSettingChange } from "../lib/sentry-config";

const CONFIG_FILE = "sentry-config.yml";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function org(method: "GET" | "PUT", body?: unknown): Promise<Record<string, unknown>> {
  const token = process.env.SENTRY_CONFIG_TOKEN;
  if (!token) fail("SENTRY_CONFIG_TOKEN is not set");
  const res = await fetch(`${appConfig.sentry.apiUrl}/api/0/organizations/${appConfig.sentry.org}/`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${method} organization: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

function printChanges(changes: OrgSettingChange[]): void {
  if (changes.length === 0) return console.log("No differences.");
  for (const c of changes) console.log(`~ ${c.key}: ${c.live ?? "unset"} -> ${c.desired}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "diff" && mode !== "push") fail("usage: sentry-config.ts diff|push");

  const desired = parseSentryConfig(parseYaml(readFileSync(CONFIG_FILE, "utf8")));
  const changes = planOrgSettings(await org("GET"), desired);

  console.log(`${CONFIG_FILE} vs the live Sentry organization (${appConfig.sentry.org}):`);
  printChanges(changes);
  if (mode === "diff" || changes.length === 0) return;

  await org("PUT", orgSettingsBody(changes));

  // Read back: a setting Sentry silently ignored must not look like a success.
  const remaining = planOrgSettings(await org("GET"), desired);
  if (remaining.length > 0) {
    printChanges(remaining);
    fail("The live organization still differs from the file after the push");
  }
  console.log("✓ Sentry organization settings updated");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

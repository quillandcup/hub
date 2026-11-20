#!/usr/bin/env npx tsx
// Diffs or pushes config/sentry.yml against the live Sentry organization, so the data-scrubbing settings and the
// issue alert rules are reviewed in git instead of clicked in the dashboard. CI runs `push` after every production
// deploy that changed the file or this script (ci.yml, push-sentry-config job); `pnpm sentry:config:diff` is the
// read-only preview.
//
//   tsx scripts/sentry-config.ts diff   show what a push would change (read-only)
//   tsx scripts/sentry-config.ts push   apply the file to the live organization
//
// Only the settings the file lists are written (PUT /api/0/organizations/<org>/ with just those keys). The alert
// rules are the workflows whose name starts with the managed prefix (lib/sentry-config.ts): created, updated or
// deleted to match the file. Sentry's own default alerts are never touched.
//
// Env: SENTRY_CONFIG_TOKEN, an internal integration token with Organization: Read & Write, Project: Read and
// Alerts: Read & Write. It is not the build token SENTRY_AUTH_TOKEN, which can upload source maps but cannot read
// organization settings.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import appConfig from "../app.config";
import {
  orgSettingsBody,
  parseAlertRules,
  parseSentryConfig,
  planOrgSettings,
  planWorkflows,
  type LiveWorkflow,
  type OrgSettingChange,
  type WorkflowChange,
} from "../lib/sentry-config";
import { outboundFetch } from "@/lib/http/outbound";

const CONFIG_FILE = "config/sentry.yml";
const API = `${appConfig.sentry.apiUrl}/api/0`;
const ORG = appConfig.sentry.org;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function call(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
  const token = process.env.SENTRY_CONFIG_TOKEN;
  if (!token) fail("SENTRY_CONFIG_TOKEN is not set");
  const res = await outboundFetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

async function json<T>(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

const org = (method: "GET" | "PUT", body?: unknown) => json<Record<string, unknown>>(method, `/organizations/${ORG}/`, body);

/** All workflows of the organization, following Sentry's cursor pagination. */
async function liveWorkflows(): Promise<LiveWorkflow[]> {
  const all: LiveWorkflow[] = [];
  let path: string | null = `/organizations/${ORG}/workflows/?per_page=100`;
  while (path) {
    const res = await call("GET", path);
    all.push(...((await res.json()) as LiveWorkflow[]));
    const next = /<([^>]+)>; rel="next"; results="true"/.exec(res.headers.get("link") ?? "");
    path = next ? next[1].slice(next[1].indexOf("/organizations/")) : null;
  }
  return all;
}

/** The project's issue stream detector: what an issue alert hangs on. */
async function issueStreamDetectorId(): Promise<string> {
  const project = await json<{ id: string }>("GET", `/projects/${ORG}/${appConfig.sentry.project}/`);
  const detectors = await json<{ id: string; type: string }[]>("GET", `/organizations/${ORG}/detectors/?project=${project.id}`);
  const stream = detectors.find((d) => d.type === "issue_stream");
  if (!stream) fail(`No issue stream detector for project ${appConfig.sentry.project}`);
  return stream.id;
}

function printChanges(changes: OrgSettingChange[]): void {
  for (const c of changes) console.log(`~ ${c.key}: ${c.live ?? "unset"} -> ${c.desired}`);
}

function printWorkflowChanges(changes: WorkflowChange[]): void {
  const sign = { create: "+", update: "~", delete: "-" } as const;
  for (const c of changes) console.log(`${sign[c.kind]} alert "${c.name}" (${c.kind})`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "diff" && mode !== "push") fail("usage: sentry-config.ts diff|push");

  const raw = parseYaml(readFileSync(CONFIG_FILE, "utf8"));
  const desired = parseSentryConfig(raw);
  const rules = parseAlertRules(raw);
  const detectorId = await issueStreamDetectorId();

  const changes = planOrgSettings(await org("GET"), desired);
  const workflowChanges = planWorkflows(await liveWorkflows(), rules, detectorId);

  console.log(`${CONFIG_FILE} vs the live Sentry organization (${ORG}):`);
  if (changes.length === 0 && workflowChanges.length === 0) return console.log("No differences.");
  printChanges(changes);
  printWorkflowChanges(workflowChanges);
  if (mode === "diff") return;

  if (changes.length > 0) await org("PUT", orgSettingsBody(changes));
  for (const c of workflowChanges) {
    if (c.kind === "create") await json("POST", `/organizations/${ORG}/workflows/`, c.body);
    else if (c.kind === "update") await json("PUT", `/organizations/${ORG}/workflows/${c.id}/`, c.body);
    else await call("DELETE", `/organizations/${ORG}/workflows/${c.id}/`);
  }

  // Read back: a setting or rule Sentry silently ignored must not look like a success.
  const remaining = planOrgSettings(await org("GET"), desired);
  const remainingWorkflows = planWorkflows(await liveWorkflows(), rules, detectorId);
  if (remaining.length > 0 || remainingWorkflows.length > 0) {
    printChanges(remaining);
    printWorkflowChanges(remainingWorkflows);
    fail("The live Sentry configuration still differs from the file after the push");
  }
  console.log("✓ Sentry organization settings and alert rules updated");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

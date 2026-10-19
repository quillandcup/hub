#!/usr/bin/env npx tsx
// Review or reconcile the Sentry workflows in sentry-alerts.config.ts.
// validate needs no credentials; diff is read-only; push creates/updates only named workflows.
// Unmanaged Sentry alerts are never deleted or changed.

import { SENTRY_SLACK_ALERTS, SENTRY_SLACK_ALERT_DESTINATION } from "../sentry-alerts.config";

const ORG = "quillandcup";
const PROJECT = "hub";
const API = `https://de.sentry.io/api/0/organizations/${ORG}`;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ApiItem = { id: string | number; name?: string; type?: string; projectId?: string | number; provider?: { key?: string }; status?: string; detectorIds?: Array<string | number> };
type Workflow = ApiItem & { enabled?: boolean; environment?: string; config?: Json; triggers?: Json; actionFilters?: Json };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Sentry alert diff/push`);
  return value;
}

function validate(): void {
  if (!/^#[a-z0-9][a-z0-9_-]*$/i.test(SENTRY_SLACK_ALERT_DESTINATION.channel)) throw new Error("Sentry Slack alert channel must be a #channel-name");
  if (!/^C[A-Z0-9]+$/.test(SENTRY_SLACK_ALERT_DESTINATION.channelId)) throw new Error("Sentry Slack alert channel ID is invalid");
  const names = new Set<string>();
  for (const rule of SENTRY_SLACK_ALERTS) {
    if (names.has(rule.name)) throw new Error(`Duplicate Sentry alert name: ${rule.name}`);
    names.add(rule.name);
    if (rule.environment !== "production") throw new Error(`${rule.name}: expected production environment`);
  }
  console.log(`Validated ${names.size} Sentry Slack alert definitions.`);
}

async function api(path: string, method = "GET", body?: Json): Promise<{ data: unknown; next: string | null }> {
  const response = await fetch(path.startsWith("https://") ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${required("SENTRY_ALERTS_AUTH_TOKEN")}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    // Sentry may echo submitted payloads in validation errors. Keep credentials and member data out of CLI output.
    throw new Error(`${method} ${new URL(response.url).pathname}: HTTP ${response.status}${response.status === 403 ? " (token needs alerts:read/alerts:write and org:read)" : ""}`);
  }
  const link = response.headers.get("link") ?? "";
  const next = link.split(",").find((part) => part.includes('rel="next"') && part.includes('results="true"'))?.match(/<([^>]+)>/)?.[1] ?? null;
  return { data: raw ? JSON.parse(raw) : null, next };
}

async function all(path: string): Promise<ApiItem[]> {
  const rows: ApiItem[] = [];
  let next: string | null = `${API}${path}`;
  while (next) {
    const page = await api(next);
    if (!Array.isArray(page.data)) throw new Error(`Unexpected Sentry list response for ${path}`);
    rows.push(...page.data as ApiItem[]);
    next = page.next;
  }
  return rows;
}

function one<T>(items: T[], label: string): T {
  if (items.length !== 1) throw new Error(`Expected one ${label}; found ${items.length}`);
  return items[0];
}

function desired(name: string, environment: string, condition: Json, detectorId: string, integrationId: string, channel: string): Json {
  const trigger = (type: string) => ({ type, comparison: true, conditionResult: true });
  return {
    name,
    enabled: true,
    environment,
    detector_ids: [Number(detectorId)],
    config: { frequency: 5 },
    triggers: {
      logicType: "any-short",
      conditions: [trigger("first_seen_event"), trigger("regression_event"), trigger("reappeared_event")],
      actions: [],
    },
    action_filters: [{
      logicType: "all",
      conditions: [condition],
      actions: [{
        type: "slack",
        integrationId,
        config: { targetType: "specific", targetIdentifier: "", targetDisplay: channel.slice(1) },
        data: {},
        status: "active",
      }],
    }],
  };
}

function comparable(value: Json): string {
  const canonical = (item: Json | undefined): Json => {
    if (item === undefined) return null;
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort().map(([key, entry]) => [key, canonical(entry)]));
    return item;
  };
  return JSON.stringify(canonical(value));
}

function liveShape(live: Workflow): Json {
  const conditions = (rows: unknown) => Array.isArray(rows) ? rows.map((row) => {
    const r = row as Record<string, Json>;
    return { type: r.type, comparison: r.comparison, conditionResult: r.conditionResult };
  }) : [];
  const trigger = (live.triggers ?? {}) as Record<string, unknown>;
  const filters = Array.isArray(live.actionFilters) ? live.actionFilters : [];
  return {
    name: live.name ?? "",
    enabled: live.enabled ?? false,
    environment: live.environment ?? "",
    detector_ids: (live.detectorIds ?? []).map(Number),
    config: { frequency: ((live.config ?? {}) as Record<string, Json>).frequency ?? null },
    triggers: { logicType: String(trigger.logicType ?? ""), conditions: conditions(trigger.conditions), actions: [] },
    action_filters: filters.map((item) => {
      const f = item as Record<string, unknown>;
      return {
        logicType: String(f.logicType ?? ""),
        conditions: conditions(f.conditions),
        actions: (Array.isArray(f.actions) ? f.actions : []).map((item) => {
          const a = item as Record<string, Json>;
          return { type: a.type ?? null, integrationId: a.integrationId ?? null, config: a.config ?? null, data: a.data ?? null, status: a.status ?? null };
        }),
      };
    }),
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "validate" && mode !== "diff" && mode !== "push") throw new Error("Usage: sentry-alerts.ts validate|diff|push");
  validate();
  if (mode === "validate") return;

  const channel = SENTRY_SLACK_ALERT_DESTINATION.channel;
  const [detectors, integrations, workflows] = await Promise.all([
    all(`/detectors/?project=${PROJECT}&per_page=100`),
    all("/integrations/?providerKey=slack&per_page=100"),
    all("/workflows/?per_page=100"),
  ]);
  const errorDetectors = detectors.filter((d) => d.type === "error");
  const detector = one(errorDetectors.length ? errorDetectors : detectors.filter((d) => d.type === "issue_stream"), `${PROJECT} error monitor`);
  const slackCandidates = integrations.filter((i) => i.provider?.key === "slack" && i.status === "active");
  const selectedIntegrationId = process.env.SENTRY_ALERTS_SLACK_INTEGRATION_ID;
  const slack = one(selectedIntegrationId ? slackCandidates.filter((i) => String(i.id) === selectedIntegrationId) : slackCandidates, "active Sentry Slack integration");
  const byName = new Map(workflows.map((w) => [w.name, w as Workflow]));
  let changed = 0;
  for (const rule of SENTRY_SLACK_ALERTS) {
    const want = desired(rule.name, rule.environment, rule.condition as Json, String(detector.id), String(slack.id), channel);
    const live = byName.get(rule.name);
    if (live && comparable(liveShape(live)) === comparable(want)) {
      console.log(`= ${rule.name}: current`);
      continue;
    }
    changed++;
    console.log(`${live ? "~" : "+"} ${rule.name}: ${live ? "update" : "create"} (${rule.environment} → ${channel})`);
    if (mode === "push") {
      await api(live ? `/workflows/${live.id}/` : "/workflows/", live ? "PUT" : "POST", want);
    }
  }
  console.log(mode === "push" ? `Applied ${changed} Sentry alert change(s).` : `${changed} Sentry alert change(s) pending.`);
}

main().catch((error) => { console.error(`✗ ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

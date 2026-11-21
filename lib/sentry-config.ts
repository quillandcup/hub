// Pure logic behind `pnpm sentry:config:diff` / `:push` (scripts/sentry-config.ts): turn the committed
// config/sentry.yml into the desired organization settings, and compare them with what Sentry reports. No
// network and no secrets here, so it is unit-tested (tests/lib/sentry-config.test.ts). See docs/SENTRY_CONFIG.md.

/** The organization settings the file manages, under their names in Sentry's API. */
export const ORG_SETTING_KEYS = ["dataScrubber", "dataScrubberDefaults", "scrubIPAddresses"] as const;

export type OrgSettingKey = (typeof ORG_SETTING_KEYS)[number];
export type OrgSettings = Record<OrgSettingKey, boolean>;

export interface OrgSettingChange {
  key: OrgSettingKey;
  live: boolean | undefined;
  desired: boolean;
}

/** Reads `organization:` from config/sentry.yml. Every setting must be listed, so none is dropped by accident. */
export function parseSentryConfig(raw: unknown): OrgSettings {
  const org = ((raw ?? {}) as Record<string, unknown>).organization;
  if (typeof org !== "object" || org === null) throw new Error("config/sentry.yml: organization must be a map");
  const entries = org as Record<string, unknown>;
  const unknown = Object.keys(entries).filter((key) => !(ORG_SETTING_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new Error(`config/sentry.yml: unknown organization setting ${unknown.join(", ")}`);
  const settings = {} as OrgSettings;
  for (const key of ORG_SETTING_KEYS) {
    const value = entries[key];
    if (typeof value !== "boolean") throw new Error(`config/sentry.yml: organization.${key} must be true or false`);
    settings[key] = value;
  }
  return settings;
}

/** The settings whose live value differs from the file. */
export function planOrgSettings(live: Partial<Record<string, unknown>>, desired: OrgSettings): OrgSettingChange[] {
  return ORG_SETTING_KEYS.flatMap((key) => {
    const value = typeof live[key] === "boolean" ? (live[key] as boolean) : undefined;
    return value === desired[key] ? [] : [{ key, live: value, desired: desired[key] }];
  });
}

/** The request body for a push: only what changes, so nothing else on the organization is touched. */
export function orgSettingsBody(changes: OrgSettingChange[]): Partial<OrgSettings> {
  return Object.fromEntries(changes.map((c) => [c.key, c.desired])) as Partial<OrgSettings>;
}

// ---- Issue alert rules (Sentry "workflows") ----------------------------------------------------------------
//
// The organization is on Sentry's workflow engine, so an issue alert is a workflow: triggers (when it is
// evaluated), action filters (conditions plus the notification) and the detector it hangs on (the project's
// issue stream). Only workflows named with MANAGED_RULE_PREFIX are managed: Sentry's own defaults (pull request,
// high priority) are never touched, and removing a managed rule from the file removes it from Sentry.

export const MANAGED_RULE_PREFIX = "Hub: ";
export const ALERT_INTERVALS = ["1m", "5m", "15m", "1h", "1d", "1w", "30d"] as const;
export const ALERT_TRIGGERS = ["new_issue", "regression", "every_event"] as const;

export type AlertInterval = (typeof ALERT_INTERVALS)[number];
export type AlertTrigger = (typeof ALERT_TRIGGERS)[number];

export interface AlertRule {
  name: string;
  when: AlertTrigger;
  /** Only events with this tag: set to `value` when one is given, merely present when not. */
  tag: { key: string; value?: string };
  /** Only with `when: every_event`: fire once the issue has more than `count` events within `interval`. Without it the rule fires on an issue's first event, then at most every `frequencyMinutes`. */
  moreThan?: { count: number; interval: AlertInterval };
  /** Minutes between two notifications for the same issue (Sentry accepts 0, 5, 10, 30, 60, 180, 720, 1440). */
  frequencyMinutes: number;
}

const TRIGGER_CONDITION: Record<AlertTrigger, string> = {
  new_issue: "first_seen_event",
  regression: "regression_event",
  every_event: "every_event",
};

/** Reads `alerts:` from config/sentry.yml (a list of rules). Absent means no managed rules. */
export function parseAlertRules(raw: unknown): AlertRule[] {
  const alerts = ((raw ?? {}) as Record<string, unknown>).alerts;
  if (alerts === undefined || alerts === null) return [];
  if (!Array.isArray(alerts)) throw new Error("config/sentry.yml: alerts must be a list");
  const rules = alerts.map((entry, i): AlertRule => {
    const where = `config/sentry.yml: alerts[${i}]`;
    const e = (entry ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(e).filter((k) => !["name", "when", "tag", "moreThan", "frequencyMinutes"].includes(k));
    if (unknown.length > 0) throw new Error(`${where}: unknown key ${unknown.join(", ")}`);
    if (typeof e.name !== "string" || !e.name.startsWith(MANAGED_RULE_PREFIX) || e.name.length > 256) {
      throw new Error(`${where}: name must be a string starting with "${MANAGED_RULE_PREFIX}"`);
    }
    if (!(ALERT_TRIGGERS as readonly unknown[]).includes(e.when)) {
      throw new Error(`${where}: when must be one of ${ALERT_TRIGGERS.join(", ")}`);
    }
    const tag = (e.tag ?? {}) as Record<string, unknown>;
    const badTag =
      typeof e.tag !== "object" ||
      e.tag === null ||
      typeof tag.key !== "string" ||
      tag.key === "" ||
      (tag.value !== undefined && (typeof tag.value !== "string" || tag.value === "")) ||
      Object.keys(tag).some((k) => k !== "key" && k !== "value");
    if (badTag) throw new Error(`${where}: tag must be { key, value? } with non-empty strings`);
    if (!Number.isInteger(e.frequencyMinutes) || (e.frequencyMinutes as number) < 0) {
      throw new Error(`${where}: frequencyMinutes must be a whole number of minutes`);
    }
    const rule: AlertRule = {
      name: e.name,
      when: e.when as AlertTrigger,
      tag: tag.value === undefined ? { key: tag.key as string } : { key: tag.key as string, value: tag.value as string },
      frequencyMinutes: e.frequencyMinutes as number,
    };
    if (e.moreThan !== undefined) {
      const m = (e.moreThan ?? {}) as Record<string, unknown>;
      if (rule.when !== "every_event") throw new Error(`${where}: moreThan needs when: every_event`);
      if (!Number.isInteger(m.count) || (m.count as number) < 1 || !(ALERT_INTERVALS as readonly unknown[]).includes(m.interval)) {
        throw new Error(`${where}: moreThan needs a count of 1 or more and an interval of ${ALERT_INTERVALS.join(", ")}`);
      }
      rule.moreThan = { count: m.count as number, interval: m.interval as AlertInterval };
    } else if (rule.when === "every_event" && rule.frequencyMinutes === 0) {
      // Without a threshold the rule fires on every event of an issue; frequencyMinutes is what throttles it.
      throw new Error(`${where}: when: every_event needs moreThan or a frequencyMinutes above 0, or it would email on every event`);
    }
    return rule;
  });
  const names = rules.map((r) => r.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) throw new Error(`config/sentry.yml: alert "${duplicate}" is listed twice`);
  return rules;
}

/** The body Sentry's workflow API takes for a rule: email to the issue owners, or active members without owner. */
export function workflowBody(rule: AlertRule, detectorId: string): Record<string, unknown> {
  const filters: Record<string, unknown>[] = [
    {
      type: "tagged_event",
      // "is" matches when the tag is set at all; "eq" when it equals the value.
      comparison: rule.tag.value === undefined ? { key: rule.tag.key, match: "is" } : { key: rule.tag.key, match: "eq", value: rule.tag.value },
      conditionResult: true,
    },
  ];
  if (rule.moreThan) {
    filters.push({
      type: "event_frequency_count",
      comparison: { interval: rule.moreThan.interval, value: rule.moreThan.count },
      conditionResult: true,
    });
  }
  return {
    name: rule.name,
    enabled: true,
    config: { frequency: rule.frequencyMinutes },
    environment: null,
    detectorIds: [detectorId],
    triggers: {
      logicType: "any-short",
      conditions: [{ type: TRIGGER_CONDITION[rule.when], comparison: true, conditionResult: true }],
    },
    actionFilters: [
      {
        logicType: "all",
        conditions: filters,
        actions: [
          {
            type: "email",
            integrationId: null,
            data: { fallthroughType: "ActiveMembers" },
            config: { targetType: "issue_owners", targetIdentifier: null },
          },
        ],
      },
    ],
  };
}

export type WorkflowChange =
  | { kind: "create"; name: string; body: Record<string, unknown> }
  | { kind: "update"; name: string; id: string; body: Record<string, unknown> }
  | { kind: "delete"; name: string; id: string };

export interface LiveWorkflow {
  id: string;
  name: string;
  [key: string]: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when `live` holds everything `desired` says; extra keys Sentry adds (ids, dates, defaults) don't count. */
export function covers(live: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) {
    if (!Array.isArray(live) || live.length !== desired.length) return false;
    // Order is not meaningful for conditions and actions: match each desired item to a distinct live one.
    const free = [...live];
    return desired.every((d) => {
      const at = free.findIndex((l) => covers(l, d));
      if (at === -1) return false;
      free.splice(at, 1);
      return true;
    });
  }
  if (isPlainObject(desired)) {
    return isPlainObject(live) && Object.entries(desired).every(([k, v]) => covers(live[k], v));
  }
  // Ids come back as strings where a body may hold numbers: compare as text.
  return String(live ?? null) === String(desired ?? null);
}

/** What a push must do so the managed workflows match the file; unmanaged workflows are never listed. */
export function planWorkflows(live: LiveWorkflow[], rules: AlertRule[], detectorId: string): WorkflowChange[] {
  const managed = live.filter((w) => w.name.startsWith(MANAGED_RULE_PREFIX));
  const changes: WorkflowChange[] = [];
  for (const rule of rules) {
    const body = workflowBody(rule, detectorId);
    const existing = managed.find((w) => w.name === rule.name);
    if (!existing) changes.push({ kind: "create", name: rule.name, body });
    else if (!covers(existing, body)) changes.push({ kind: "update", name: rule.name, id: existing.id, body });
  }
  const wanted = new Set(rules.map((r) => r.name));
  for (const w of managed) if (!wanted.has(w.name)) changes.push({ kind: "delete", name: w.name, id: w.id });
  return changes;
}

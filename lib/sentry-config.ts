// Pure logic behind `pnpm sentry:config:diff` / `:push` (scripts/sentry-config.ts): turn the committed
// sentry-config.yml into the desired organization settings, and compare them with what Sentry reports. No
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

/** Reads `organization:` from sentry-config.yml. Every setting must be listed, so none is dropped by accident. */
export function parseSentryConfig(raw: unknown): OrgSettings {
  const org = ((raw ?? {}) as Record<string, unknown>).organization;
  if (typeof org !== "object" || org === null) throw new Error("sentry-config.yml: organization must be a map");
  const entries = org as Record<string, unknown>;
  const unknown = Object.keys(entries).filter((key) => !(ORG_SETTING_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new Error(`sentry-config.yml: unknown organization setting ${unknown.join(", ")}`);
  const settings = {} as OrgSettings;
  for (const key of ORG_SETTING_KEYS) {
    const value = entries[key];
    if (typeof value !== "boolean") throw new Error(`sentry-config.yml: organization.${key} must be true or false`);
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

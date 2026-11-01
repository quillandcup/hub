import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { ORG_SETTING_KEYS, orgSettingsBody, parseSentryConfig, planOrgSettings } from "@/lib/sentry-config";
import { ENV_VARS } from "@/env-vars.config";

const on = { dataScrubber: true, dataScrubberDefaults: true, scrubIPAddresses: true };

describe("sentry-config.yml", () => {
  it("lists every managed setting, switched on", () => {
    const parsed = parseSentryConfig(parseYaml(readFileSync("sentry-config.yml", "utf8")));
    expect(Object.keys(parsed).sort()).toEqual([...ORG_SETTING_KEYS].sort());
    expect(Object.values(parsed).every((value) => value === true)).toBe(true);
  });

  it("is applied by a CI job that has the token, and the token is a GitHub-only secret", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("push-sentry-config:");
    expect(ci).toContain("SENTRY_CONFIG_TOKEN: ${{ secrets.SENTRY_CONFIG_TOKEN }}");
    const spec = ENV_VARS.find((v) => v.name === "SENTRY_CONFIG_TOKEN");
    expect(spec?.type).toBe("secret");
    expect(spec?.destinations).toEqual([{ kind: "github" }]);
  });
});

describe("parseSentryConfig", () => {
  it("reads the three settings", () => {
    expect(parseSentryConfig({ organization: on })).toEqual(on);
  });

  it("rejects a missing, non-boolean or unknown setting", () => {
    expect(() => parseSentryConfig({})).toThrow(/organization must be a map/);
    expect(() => parseSentryConfig({ organization: { ...on, scrubIPAddresses: undefined } })).toThrow(/scrubIPAddresses must be true or false/);
    expect(() => parseSentryConfig({ organization: { ...on, dataScrubber: "yes" } })).toThrow(/dataScrubber must be true or false/);
    expect(() => parseSentryConfig({ organization: { ...on, allowJoinRequests: false } })).toThrow(/unknown organization setting allowJoinRequests/);
  });
});

describe("planOrgSettings", () => {
  it("reports nothing when the live organization already matches", () => {
    expect(planOrgSettings({ ...on, slug: "x", require2FA: false }, on)).toEqual([]);
  });

  it("reports each setting that differs, including one Sentry did not return", () => {
    const changes = planOrgSettings({ dataScrubber: false, dataScrubberDefaults: true }, on);
    expect(changes).toEqual([
      { key: "dataScrubber", live: false, desired: true },
      { key: "scrubIPAddresses", live: undefined, desired: true },
    ]);
  });

  it("sends only the changed settings", () => {
    expect(orgSettingsBody(planOrgSettings({ ...on, scrubIPAddresses: false }, on))).toEqual({ scrubIPAddresses: true });
  });
});

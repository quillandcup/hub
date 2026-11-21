import { readFileSync } from "node:fs";
import { CSP_HEALTH_TAG } from "@/lib/csp-health";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  ORG_SETTING_KEYS,
  covers,
  orgSettingsBody,
  parseAlertRules,
  parseSentryConfig,
  planOrgSettings,
  planWorkflows,
  workflowBody,
  type LiveWorkflow,
} from "@/lib/sentry-config";
import { ENV_VARS } from "@/config/env-vars";

const on = { dataScrubber: true, dataScrubberDefaults: true, scrubIPAddresses: true };

describe("config/sentry.yml", () => {
  it("lists every managed setting, switched on", () => {
    const parsed = parseSentryConfig(parseYaml(readFileSync("config/sentry.yml", "utf8")));
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

const rule = { name: "Hub: CSP, new issue", when: "new_issue", tag: { key: "logger", value: "csp" }, frequencyMinutes: 0 };
const burst = { name: "Hub: CSP, burst", when: "every_event", tag: { key: "logger", value: "csp" }, moreThan: { count: 100, interval: "1h" }, frequencyMinutes: 60 };

describe("config/sentry.yml alerts", () => {
  const rules = parseAlertRules(parseYaml(readFileSync("config/sentry.yml", "utf8")));

  it("has the three CSP report alerts, each limited to logger csp", () => {
    const reports = rules.filter((r) => r.tag.key === "logger" && r.tag.value === "csp");
    expect(reports.map((r) => r.when).sort()).toEqual(["every_event", "new_issue", "regression"]);
    expect(reports.find((r) => r.when === "every_event")?.moreThan).toEqual({ count: 100, interval: "1h" });
  });

  it("emails about the health check events (tag csp_health_check, set or not) at most once a day per issue", () => {
    const health = rules.filter((r) => r.tag.key === CSP_HEALTH_TAG);
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ when: "every_event", frequencyMinutes: 1440 });
    expect(health[0].moreThan).toBeUndefined();
    expect(rules).toHaveLength(4);
  });
});

describe("parseAlertRules", () => {
  it("is empty without an alerts list", () => {
    expect(parseAlertRules({ organization: on })).toEqual([]);
    expect(parseAlertRules(null)).toEqual([]);
  });

  it("reads rules, with and without a frequency threshold", () => {
    expect(parseAlertRules({ alerts: [rule, burst] })).toEqual([rule, burst]);
  });

  it.each([
    [{ alerts: "x" }, /must be a list/],
    [{ alerts: [{ ...rule, name: "CSP, new issue" }] }, /starting with "Hub: "/],
    [{ alerts: [{ ...rule, when: "always" }] }, /when must be one of/],
    [{ alerts: [{ ...rule, tag: { key: "" } }] }, /tag must be/],
    [{ alerts: [{ ...rule, tag: undefined }] }, /tag must be/],
    [{ alerts: [{ ...rule, tag: { key: "logger", value: "" } }] }, /tag must be/],
    [{ alerts: [{ ...rule, tag: { key: "logger", extra: 1 } }] }, /tag must be/],
    [{ alerts: [{ ...rule, frequencyMinutes: -1 }] }, /frequencyMinutes/],
    [{ alerts: [{ ...rule, extra: 1 }] }, /unknown key extra/],
    [{ alerts: [{ ...rule, moreThan: { count: 5, interval: "1h" } }] }, /needs when: every_event/],
    [{ alerts: [{ ...burst, moreThan: { count: 0, interval: "1h" } }] }, /count of 1 or more/],
    [{ alerts: [{ ...burst, moreThan: { count: 5, interval: "2h" } }] }, /interval of/],
    [{ alerts: [{ ...burst, moreThan: undefined, frequencyMinutes: 0 }] }, /needs moreThan or a frequencyMinutes/],
    [{ alerts: [rule, rule] }, /listed twice/],
  ])("rejects %j", (raw, message) => {
    expect(() => parseAlertRules(raw)).toThrow(message);
  });
});

describe("workflowBody", () => {
  it("filters on the logger tag, emails, and hangs on the detector", () => {
    const body = workflowBody(parseAlertRules({ alerts: [rule] })[0], "77");
    expect(body).toMatchObject({
      name: rule.name,
      detectorIds: ["77"],
      config: { frequency: 0 },
      triggers: { conditions: [{ type: "first_seen_event" }] },
      actionFilters: [
        {
          conditions: [{ type: "tagged_event", comparison: { key: "logger", match: "eq", value: "csp" } }],
          actions: [{ type: "email" }],
        },
      ],
    });
  });

  it("filters a health-check rule on its tag being set, and throttles it with the frequency, with no count filter", () => {
    const body = workflowBody(parseAlertRules({ alerts: [{ name: "Hub: x", when: "every_event", tag: { key: "csp_health_check" }, frequencyMinutes: 1440 }] })[0], "77") as {
      config: { frequency: number };
      actionFilters: { conditions: { type: string; comparison: Record<string, string> }[] }[];
    };
    expect(body.config.frequency).toBe(1440);
    expect(body.actionFilters[0].conditions).toHaveLength(1);
    expect(body.actionFilters[0].conditions[0]).toMatchObject({ type: "tagged_event", comparison: { key: "csp_health_check", match: "is" } });
    expect(body.actionFilters[0].conditions[0].comparison).not.toHaveProperty("value");
  });

  it("adds the frequency filter and the every-event trigger for a burst rule", () => {
    const body = workflowBody(parseAlertRules({ alerts: [burst] })[0], "77") as {
      triggers: { conditions: { type: string }[] };
      actionFilters: { conditions: { type: string; comparison: unknown }[] }[];
    };
    expect(body.triggers.conditions[0].type).toBe("every_event");
    expect(body.actionFilters[0].conditions[1]).toMatchObject({ type: "event_frequency_count", comparison: { interval: "1h", value: 100 } });
  });
});

describe("covers", () => {
  it("ignores keys Sentry adds, compares ids as text and ignores list order", () => {
    expect(covers({ a: 1, extra: true }, { a: 1 })).toBe(true);
    expect(covers({ id: "5" }, { id: 5 })).toBe(true);
    expect(covers([{ t: "b" }, { t: "a", x: 1 }], [{ t: "a" }, { t: "b" }])).toBe(true);
  });

  it("fails on a different value, length, missing key or type", () => {
    expect(covers({ a: 2 }, { a: 1 })).toBe(false);
    expect(covers([{ t: "a" }], [{ t: "a" }, { t: "a" }])).toBe(false);
    expect(covers({}, { a: 1 })).toBe(false);
    expect(covers("x", { a: 1 })).toBe(false);
    expect(covers({ a: 1 }, [1])).toBe(false);
    expect(covers([{ t: "a" }, { t: "a" }], [{ t: "a" }, { t: "b" }])).toBe(false);
  });
});

describe("planWorkflows", () => {
  const rules = parseAlertRules({ alerts: [rule, burst] });
  const asLive = (r: (typeof rules)[number], id: string) => ({ ...workflowBody(r, "77"), id, dateCreated: "x" }) as unknown as LiveWorkflow;
  const sentryDefault = { id: "1", name: "Send a notification for high priority issues" } as LiveWorkflow;

  it("creates every rule that is missing", () => {
    expect(planWorkflows([sentryDefault], rules, "77").map((c) => [c.kind, c.name])).toEqual([
      ["create", rule.name],
      ["create", burst.name],
    ]);
  });

  it("is idempotent: a second plan against the pushed state has nothing to do", () => {
    expect(planWorkflows([sentryDefault, asLive(rules[0], "10"), asLive(rules[1], "11")], rules, "77")).toEqual([]);
  });

  it("updates a rule whose threshold changed, matched by name", () => {
    const changed = parseAlertRules({ alerts: [rule, { ...burst, moreThan: { count: 200, interval: "1h" } }] });
    const plan = planWorkflows([asLive(rules[0], "10"), asLive(rules[1], "11")], changed, "77");
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: "update", id: "11", name: burst.name });
  });

  it("updates a rule that moved to another detector or was disabled", () => {
    expect(planWorkflows([asLive(rules[0], "10")], [rules[0]], "78").map((c) => c.kind)).toEqual(["update"]);
    const off = { ...asLive(rules[0], "10"), enabled: false } as LiveWorkflow;
    expect(planWorkflows([off], [rules[0]], "77").map((c) => c.kind)).toEqual(["update"]);
  });

  it("deletes a managed rule that left the file, and never an unmanaged one", () => {
    const plan = planWorkflows([sentryDefault, asLive(rules[0], "10"), asLive(rules[1], "11")], [rules[0]], "77");
    expect(plan).toEqual([{ kind: "delete", name: burst.name, id: "11" }]);
  });
});

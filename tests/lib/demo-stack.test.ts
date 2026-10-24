import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ORG_TIMEZONE } from "@/lib/config";
import { DEMO_APP_PORT, DEMO_PROJECT_ID, demoConfig } from "@/demo/stack";
import { orgDate } from "@/demo/seed";
import { assertLocal } from "@/demo/env";
import { PERSONAS, demoEvents, persona } from "@/demo/personas";

const devConfig = readFileSync("supabase/config.toml", "utf8");

describe("demoConfig", () => {
  const config = demoConfig(devConfig);

  it("gets its own project id, so its containers and volumes don't collide with the dev stack", () => {
    expect(config).toMatch(new RegExp(`^project_id = "${DEMO_PROJECT_ID}"$`, "m"));
    expect(config).not.toMatch(/^project_id = "hub"$/m);
  });

  it("moves every dev port, including commented ones, off the dev range", () => {
    expect(config).not.toMatch(/^\s*#?\s*\w*port = 543\d\d$/m);
    expect(config).toMatch(/^port = 56321$/m);
    expect(config).toMatch(/^port = 56322$/m);
  });

  it("points sign-in redirects at the demo app", () => {
    expect(config).not.toContain("localhost:3000");
    expect(config).toContain(`http://localhost:${DEMO_APP_PORT}`);
  });

  it("drops the production overrides and the dev seed", () => {
    expect(config).not.toMatch(/^\[remotes\./m);
    const seed = config.slice(config.indexOf("[db.seed]"));
    expect(seed).toMatch(/^enabled = false$/m);
  });
});

describe("orgDate", () => {
  it("uses the org's day, not the UTC day, just after local midnight", () => {
    // 03:30 UTC on Oct 24 is 23:30 on Oct 23 in New York (daylight time).
    expect(ORG_TIMEZONE).toBe("America/New_York");
    const now = new Date("2026-10-24T03:30:00Z");
    expect(orgDate(0, now)).toBe("2026-10-23");
    expect(orgDate(1, now)).toBe("2026-10-24");
    expect(orgDate(-3, now)).toBe("2026-10-20");
  });

  it("counts calendar days across the daylight saving change", () => {
    // Clocks go back on Nov 1, 2026; a day is 25 hours long there.
    const now = new Date("2026-11-01T12:00:00Z");
    expect(orgDate(0, now)).toBe("2026-11-01");
    expect(orgDate(1, now)).toBe("2026-11-02");
  });
});

describe("assertLocal", () => {
  it.each(["http://127.0.0.1:56321", "http://localhost:56321"])("accepts %s", (url) => {
    expect(() => assertLocal(url)).not.toThrow();
  });

  it.each(["https://example.supabase.co", "http://192.168.1.5:54321"])("refuses %s", (url) => {
    expect(() => assertLocal(url)).toThrow(/only uses the local stack/);
  });
});

describe("demo cast", () => {
  it("uses invented example.com people only", () => {
    for (const p of PERSONAS) expect(p.email).toMatch(/@example\.com$/);
  });

  it("has a host for every named prickle host", () => {
    const names = new Set(PERSONAS.map((p) => p.name));
    for (const e of demoEvents(0)) {
      const host = e.summary.match(/ w\/(.+)$/)?.[1];
      if (host) expect(names.has(host)).toBe(true);
    }
  });

  it("lays the weekly rhythm over the right days, with unique keys, whatever weekday today is", () => {
    for (const today of [0, 3, 6]) {
      const events = demoEvents(today);
      expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
      // Day offset 0 is a weekday-`today` slot: Saturday (6) has the Heads Down prickle, and nothing else that day.
      if (today === 6) expect(events.filter((e) => e.dayOffset === 0).map((e) => e.summary)).toEqual(["Heads Down Prickle"]);
      expect(Math.min(...events.map((e) => e.dayOffset))).toBeGreaterThanOrEqual(-28);
      expect(Math.max(...events.map((e) => e.dayOffset))).toBeLessThanOrEqual(14);
    }
  });

  it("looks a persona up by key and rejects an unknown one", () => {
    expect(persona("member").role).toBe("member");
    expect(() => persona("nobody")).toThrow(/No demo persona/);
  });
});

import { describe, expect, it } from "vitest";
import { ENV_VARS } from "@/env-vars.config";

describe("env-vars.config.ts", () => {
  it("never makes a NEXT_PUBLIC_* var a secret", () => {
    // The production build runs in CI, where a Vercel Secret reads as "[SENSITIVE]", and
    // Next.js inlines NEXT_PUBLIC_* values into the client bundle at build time.
    const secretPublic = ENV_VARS.filter((v) => v.name.startsWith("NEXT_PUBLIC_") && v.type === "secret");
    expect(secretPublic.map((v) => v.name)).toEqual([]);
  });

  it("keeps SENTRY_AUTH_TOKEN out of Vercel (build-only secret, passed by CI)", () => {
    const spec = ENV_VARS.find((v) => v.name === "SENTRY_AUTH_TOKEN");
    expect(spec?.destinations.some((d) => d.kind === "vercel")).toBe(false);
  });

  it("declares each var once", () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it("sends only secrets to Dependabot, and each also as an Actions secret", () => {
    // Dependabot-triggered runs read Dependabot secrets instead of Actions secrets, so the
    // value is written to both; `gh variable` has no Dependabot equivalent.
    const dependabot = ENV_VARS.filter((v) => v.destinations.some((d) => d.kind === "github-dependabot"));
    expect(dependabot.map((v) => v.name)).toContain("GH_TOKEN_AUTO_MERGE");
    for (const v of dependabot) {
      expect(v.type).toBe("secret");
      expect(v.destinations.some((d) => d.kind === "github")).toBe(true);
    }
  });
});

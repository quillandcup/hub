import { describe, expect, it } from "vitest";
import appConfig from "../../app.config";
import { buildCsp, CSP_REPORT_ONLY_HEADER, sentryReportUri } from "@/lib/csp";

const DSN = "https://publickey123@o123456.ingest.de.sentry.io/4510000000";

describe("buildCsp", () => {
  const csp = buildCsp({ supabaseUrl: "https://project.supabase.co/", imageHosts: appConfig.csp.imageHosts, sentryDsn: DSN });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

  it("limits pictures to ourselves, data and blob URLs, Supabase storage and the configured hosts", () => {
    const img = directive("img-src")!.split(" ").slice(1);
    expect(img.slice(0, 4)).toEqual(["'self'", "data:", "blob:", "https://project.supabase.co"]);
    for (const host of appConfig.csp.imageHosts) expect(img).toContain(host);
    expect(img).not.toContain("https:");
    expect(img).not.toContain("*");
  });

  it("closes plugins, base tag, form targets and framing", () => {
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'self'");
  });

  it("does not claim scripts or styles yet (that needs nonces)", () => {
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });

  it("sends violation reports to Sentry's security endpoint", () => {
    expect(directive("report-uri")).toBe("report-uri https://o123456.ingest.de.sentry.io/api/4510000000/security/?sentry_key=publickey123");
  });

  it("still works without Supabase or Sentry configured, and lists each origin once", () => {
    const bare = buildCsp({ imageHosts: ["https://a.example.test", "https://a.example.test"] });
    expect(bare).toBe("img-src 'self' data: blob: https://a.example.test; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  });
});

describe("sentryReportUri", () => {
  it("is null for no DSN, a malformed one, or one without a key or project", () => {
    for (const bad of [undefined, "", "nope", "https://o1.ingest.sentry.io/123", "https://key@o1.ingest.sentry.io/"]) expect(sentryReportUri(bad), String(bad)).toBeNull();
  });
});

describe("next.config headers", () => {
  it("sends the Report-Only policy on every path, and no enforcing policy", async () => {
    const config = (await import("../../next.config")).default as { headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const keys = rules[0].headers.map((h) => h.key);
    expect(keys).toEqual([CSP_REPORT_ONLY_HEADER]);
    const value = rules[0].headers[0].value;
    for (const part of ["img-src ", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) expect(value).toContain(part);
  });
});

import { describe, expect, it } from "vitest";
import appConfig from "../../app.config";
import { buildCsp, CSP_HEADER, SECURITY_HEADERS, describeCspRequestHeaders, generateNonce, scriptStyleCsp, sentryReportUri } from "@/lib/csp";

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
  it("sends the enforcing policy and the other browser protections on every path, and no Report-Only policy", async () => {
    const config = (await import("../../next.config")).default as { headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const keys = rules[0].headers.map((h) => h.key);
    expect(keys).toEqual([CSP_HEADER, ...SECURITY_HEADERS.map((h) => h.key)]);
    expect(keys).not.toContain("Content-Security-Policy-Report-Only");
    const value = rules[0].headers[0].value;
    for (const part of ["img-src ", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) expect(value).toContain(part);
  });

  it("sets nosniff, a referrer policy, same-origin framing and no camera, microphone or location", () => {
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["X-Frame-Options"]).toBe("SAMEORIGIN");
    for (const feature of ["camera", "microphone", "geolocation"]) expect(byKey["Permissions-Policy"]).toContain(`${feature}=()`);
  });

  it("allows the Kajabi storage host that /courses thumbnails load from", () => {
    expect(appConfig.csp.imageHosts).toContain("https://kajabi-storefronts-production.s3.amazonaws.com");
  });
});

describe("next.config redirects", () => {
  it("sends the old Identity tab of the member page to Account", async () => {
    const config = (await import("../../next.config")).default as { redirects?: () => Promise<{ source: string; destination: string; permanent: boolean }[]> };
    expect(await config.redirects!()).toContainEqual({ source: "/admin/members/:id/identity", destination: "/admin/members/:id/account", permanent: true });
  });
});

describe("scriptStyleCsp", () => {
  const nonce = generateNonce();
  const policy = scriptStyleCsp({ nonce, sentryDsn: DSN });

  it("allows scripts and styles only from us or with the nonce", () => {
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).not.toContain("unsafe-eval");
  });

  it("allows eval only in development", () => {
    expect(scriptStyleCsp({ nonce, dev: true })).toContain("'unsafe-eval'");
  });

  it("reports to Sentry when there is a DSN", () => {
    expect(policy).toContain("report-uri ");
    expect(scriptStyleCsp({ nonce })).not.toContain("report-uri");
  });

  it("makes a new nonce each time, in a form Next accepts", () => {
    expect(generateNonce()).not.toBe(generateNonce());
    expect(nonce).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
  });
});

describe("describeCspRequestHeaders (temporary diagnostic)", () => {
  it("shows the policy headers a request holds, without nonce values", () => {
    const headers = new Headers({ "content-security-policy": "script-src 'self' 'nonce-SECRET' 'strict-dynamic'", "x-nonce": "SECRET" });
    const seen = JSON.parse(describeCspRequestHeaders(headers));
    expect(seen.csp).toBe("script-src 'self' 'nonce-…' 'strict-dynamic'");
    expect(seen.reportOnly).toBeNull();
    expect(seen.nonceHeader).toBe(true);
    expect(describeCspRequestHeaders(headers)).not.toContain("SECRET");
  });
});

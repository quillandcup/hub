import { describe, expect, it } from "vitest";
import appConfig from "../../app.config";
import { buildCsp, CSP_HEADER, SECURITY_HEADERS, buildMetaCsp, reportOnlyCsp, generateNonce, scriptStyleCsp, sentryReportUri } from "@/lib/csp";

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
  type Rule = { source: string; headers: { key: string; value: string }[] };
  const rules = async () => {
    const config = (await import("../../next.config")).default as { headers?: () => Promise<Rule[]> };
    return config.headers!();
  };

  it("sends the other browser protections on every path, and no Report-Only policy", async () => {
    const all = (await rules()).find((r) => r.source === "/:path*")!;
    expect(all.headers.map((h) => h.key)).toEqual(SECURITY_HEADERS.map((h) => h.key));
    for (const r of await rules()) expect(r.headers.map((h) => h.key)).not.toContain("Content-Security-Policy-Report-Only");
  });

  it("sends the enforcing policy only for paths the proxy skips, which send it themselves", async () => {
    const withCsp = (await rules()).filter((r) => r.headers.some((h) => h.key === CSP_HEADER));
    expect(withCsp.length).toBeGreaterThan(0);
    expect(withCsp.map((r) => r.source)).not.toContain("/:path*");
    const value = withCsp[0].headers.find((h) => h.key === CSP_HEADER)!.value;
    for (const part of ["img-src ", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) expect(value).toContain(part);
  });

  it("covers each prefix the proxy matcher excludes", async () => {
    const sources = (await rules()).map((r) => r.source).join(" ");
    const { config } = await import("../../proxy");
    const excluded = (config.matcher[0].match(/\(\?!([^)]*)\)/)?.[1] ?? "").split("|");
    for (const prefix of ["_next/static", "_next/image", "favicon.ico", "monitoring"]) {
      expect(excluded.some((e) => e.startsWith(prefix))).toBe(true);
      expect(sources).toContain(prefix);
    }
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

describe("buildMetaCsp", () => {
  const meta = buildMetaCsp({ supabaseUrl: "https://project.supabase.co/", imageHosts: appConfig.csp.imageHosts, sentryDsn: DSN });

  it("keeps the picture, plugin, base and form directives", () => {
    for (const part of ["img-src ", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(meta).toContain(part);
    expect(meta).toContain("https://project.supabase.co");
  });

  it("leaves out what a meta tag cannot carry", () => {
    expect(meta).not.toContain("frame-ancestors");
    expect(meta).not.toContain("report-uri");
    expect(meta).not.toMatch(/script-src/);
  });
});

describe("reportOnlyCsp", () => {
  const nonce = generateNonce();
  const policy = reportOnlyCsp({
    nonce,
    supabaseUrl: "https://project.supabase.co/",
    imageHosts: appConfig.csp.imageHosts,
    connectHosts: appConfig.csp.connectHosts,
    frameHosts: appConfig.csp.frameHosts,
    mediaHosts: appConfig.csp.mediaHosts,
    sentryDsn: DSN,
  });
  const directive = (name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `));

  it("carries the script and style policy with the nonce", () => {
    expect(directive("script-src")).toContain(`'nonce-${nonce}'`);
    expect(directive("style-src")).toContain(`'nonce-${nonce}'`);
  });

  it("repeats the enforced picture, plugin, base, form and framing directives so their violations are reported", () => {
    const enforced = buildCsp({ supabaseUrl: "https://project.supabase.co/", imageHosts: appConfig.csp.imageHosts }).split("; ");
    for (const d of enforced) expect(policy.split("; ")).toContain(d);
  });

  it("adds connection, frame, media and font sources from the config, with Supabase's websocket and Sentry's host", () => {
    expect(directive("connect-src")).toContain("wss://project.supabase.co");
    expect(directive("connect-src")).toContain("https://project.supabase.co");
    expect(directive("connect-src")).toContain("https://o123456.ingest.de.sentry.io");
    for (const host of appConfig.csp.connectHosts) expect(directive("connect-src")).toContain(host);
    for (const host of appConfig.csp.frameHosts) expect(directive("frame-src")).toContain(host);
    for (const host of appConfig.csp.mediaHosts) expect(directive("media-src")).toContain(host);
    expect(directive("font-src")).toContain("'self'");
  });

  // Addresses Sentry's CSP reports named as blocked (HUB-1V/1W/1Z/20 Mux CDN, HUB-1T Mux stills as media, HUB-1Y Google beacon).
  // A small CSP source matcher: scheme, a leading `*.` wildcard on the host, and (CSP3) a path, which with no trailing
  // slash must equal the request's path (the query is ignored).
  const allows = (list: readonly string[], url: string) => {
    const target = new URL(url);
    return list.some((source) => {
      const wildcard = source.includes("*.");
      const parsed = new URL(source.replace("*.", "wildcard."));
      const hostOk = wildcard ? target.hostname.endsWith(parsed.hostname.replace("wildcard.", ".")) : target.hostname === parsed.hostname;
      const pathOk = parsed.pathname === "/" || (parsed.pathname.endsWith("/") ? target.pathname.startsWith(parsed.pathname) : target.pathname === parsed.pathname);
      return target.protocol === parsed.protocol && hostOk && pathOk;
    });
  };

  it.each([
    "https://chunk-oci-us-phoenix-1-vop1.fastly.mux.com/v1/chunk/x/0.ts",
    "https://manifest-oci-us-phoenix-1-vop1.edgemv.mux.com/x/rendition.m3u8",
    "https://stream.mux.com/x.m3u8",
    "https://www.google.com/g/collect?v=2",
  ])("lets the browser connect to %s", (url) => {
    expect(allows(appConfig.csp.connectHosts, url)).toBe(true);
  });

  it("lets Google Analytics fall back to its image beacon on any of its own hosts, including the EU one", () => {
    expect(allows(appConfig.csp.imageHosts, "https://region1.google-analytics.com/g/collect?v=2")).toBe(true);
    expect(allows(appConfig.csp.imageHosts, "https://www.google-analytics.com/g/collect?v=2")).toBe(true);
    expect(allows(appConfig.csp.imageHosts, "https://google-analytics.com.evil.example/x.gif")).toBe(false);
    expect(directive("img-src")).toContain("https://*.google-analytics.com");
  });

  it("lets video load Mux stills as media", () => {
    expect(allows(appConfig.csp.mediaHosts, "https://image.mux.com/x/thumbnail.jpg")).toBe(true);
  });

  it("does not open connections to arbitrary hosts", () => {
    expect(allows(appConfig.csp.connectHosts, "https://evil.example.com/collect")).toBe(false);
    expect(allows(appConfig.csp.connectHosts, "https://notmux.com/x")).toBe(false);
  });

  it("opens only the analytics beacon path on www.google.com, not the whole host", () => {
    expect(allows(appConfig.csp.connectHosts, "https://www.google.com/g/collect?v=2&en=page_view")).toBe(true);
    expect(allows(appConfig.csp.connectHosts, "https://www.google.com/search?q=x")).toBe(false);
    expect(allows(appConfig.csp.connectHosts, "https://www.google.com/g/collect/extra")).toBe(false);
    expect(allows(appConfig.csp.connectHosts, "https://www.google.com/")).toBe(false);
    expect(appConfig.csp.connectHosts).not.toContain("https://www.google.com");
  });

  it("names Sentry once, as the only report address", () => {
    expect(policy.match(/report-uri/g)).toHaveLength(1);
  });

  it("works with no hosts and no Supabase or Sentry settings", () => {
    const bare = reportOnlyCsp({ nonce, imageHosts: [] });
    expect(bare).toContain("connect-src 'self'");
    expect(bare).not.toContain("report-uri");
  });
});

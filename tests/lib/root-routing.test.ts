import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_ROUTING,
  decideRoute,
  firstSegment,
  isRootHost,
  normalizeHost,
  sameLocation,
  type RouteRequest,
  type RoutingConfig,
} from "@/lib/root-routing";
import { APP_URL, KAJABI_SITE_URL, ROOT_HOST, SITE_ALIAS_HOSTS, SITE_URL } from "@/lib/config";
import { matchRedirect, fillTarget, ROOT_REDIRECTS } from "@/lib/root-redirects";

// The state after the cutover (config/app.ts publicSiteLive true); the state before it is in the "not live" tests (tests/lib/public-site-flag.test.ts lists them).
vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.liveConfigModule()));

const KAJABI = new URL(KAJABI_SITE_URL).origin;

function root(pathname: string, search = "", method = "GET"): RouteRequest {
  return { host: ROOT_HOST, method, pathname, search };
}

const kajabi = (rest: string) => ({ action: "redirect", location: `${KAJABI}${rest}`, status: 307 });
const hub = (rest: string) => ({ action: "redirect", location: `${APP_URL}${rest}`, status: 307 });

describe("hosts other than the root host are left alone", () => {
  it("passes the app host, previews and localhost, whatever the path", () => {
    for (const host of [new URL(APP_URL).host, "hub-git-branch-example.vercel.app", "localhost:3000", ""]) {
      for (const pathname of ["/", "/dashboard", "/products/example-course", "/nope"]) {
        expect(decideRoute({ host, method: "GET", pathname, search: "?a=1" })).toEqual({ action: "pass", host: "app" });
      }
    }
  });

  it("does not send an unknown path on the app host to Kajabi (it stays a normal 404)", () => {
    expect(decideRoute({ host: new URL(APP_URL).host, method: "GET", pathname: "/library", search: "" }).action).toBe("pass");
  });
});

describe("www and other aliases of the public site", () => {
  it("redirects (307) to the root host with the same path and query", () => {
    for (const alias of SITE_ALIAS_HOSTS) {
      expect(decideRoute({ host: alias, method: "GET", pathname: "/offers/ExAmPlE/", search: "?coupon=EXAMPLE20&utm_source=instagram" })).toEqual({
        action: "redirect",
        location: `${SITE_URL}/offers/ExAmPlE/?coupon=EXAMPLE20&utm_source=instagram`,
        status: 307,
      });
    }
  });

  it("redirects the front page too, and ignores the case and port of the host", () => {
    expect(decideRoute({ host: `${SITE_ALIAS_HOSTS[0].toUpperCase()}:443`, method: "GET", pathname: "/", search: "" })).toEqual({
      action: "redirect",
      location: `${SITE_URL}/`,
      status: 307,
    });
  });
});

describe("the root host", () => {
  it("serves the homepage, the public pages and the platform's own paths", () => {
    for (const path of ["/", "/privacy", "/security", "/compliance", "/w/ada-example", "/p/spring", "/w/sitemap/1.xml", "/robots.txt", "/api/health", "/api/webhooks/anything", "/_next/static/x.js", "/monitoring", "/.well-known/security.txt", "/sw.js", "/manifest.webmanifest"]) {
      expect(decideRoute(root(path)), path).toEqual({ action: "pass", host: "root" });
    }
  });

  it("sends signed-in Hub paths to the same path on the app host, query kept", () => {
    expect(decideRoute(root("/dashboard", "?utm_source=email"))).toEqual(hub("/dashboard?utm_source=email"));
    expect(decideRoute(root("/admin/members/123"))).toEqual(hub("/admin/members/123"));
    expect(decideRoute(root("/auth/callback", "?code=abc"))).toEqual(hub("/auth/callback?code=abc"));
  });

  it("sends every other path to the same path on Kajabi", () => {
    expect(decideRoute(root("/library"))).toEqual(kajabi("/library"));
    expect(decideRoute(root("/products/example-course/categories/123/posts/456"))).toEqual(kajabi("/products/example-course/categories/123/posts/456"));
    expect(decideRoute(root("/blog/example-post"))).toEqual(kajabi("/blog/example-post"));
  });

  it("keeps the whole query string, percent-encoding, case and trailing slash exactly", () => {
    const search = "?utm_source=instagram&utm_medium=social&coupon=EXAMPLE20&note=a%20b%2Fc&e=reader%40example.com&e=%E2%9C%93&empty=&flag";
    expect(decideRoute(root("/Offers/ExAmPlE/checkout/", search))).toEqual(kajabi(`/Offers/ExAmPlE/checkout/${search}`));
    expect(decideRoute(root("/pages/caf%C3%A9-d%C3%A9j%C3%A0"))).toEqual(kajabi("/pages/caf%C3%A9-d%C3%A9j%C3%A0"));
    expect(decideRoute(root("/a%2Fb"))).toEqual(kajabi("/a%2Fb"));
  });

  it("keeps the method with a 307 for every method", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(decideRoute(root("/forms/example", "", method))).toEqual(kajabi("/forms/example"));
    }
  });

  it("never uses a permanent redirect for the fallback or the hub hand-over", () => {
    for (const path of ["/library", "/dashboard", "/login", "/x/"]) {
      const d = decideRoute(root(path));
      expect(d.action === "redirect" && d.status).toBe(307);
    }
  });

  it("does not treat a path that merely starts like a Hub path as one", () => {
    expect(decideRoute(root("/dashboards"))).toEqual(kajabi("/dashboards"));
    expect(decideRoute(root("/privacy-policy"))).toEqual(kajabi("/privacy-policy"));
    expect(decideRoute(root("/Privacy"))).toEqual(kajabi("/Privacy"));
    expect(decideRoute(root("/%64ashboard"))).toEqual(kajabi("/%64ashboard"));
  });

  it("goes to /login on the Hub for the root /login, query kept", () => {
    expect(decideRoute(root("/login"))).toEqual(hub("/login"));
    expect(decideRoute(root("/login", "?utm_source=email"))).toEqual(hub("/login?utm_source=email"));
  });
});

describe("open redirects", () => {
  const attempts = ["//evil.example", "//evil.example/path", "/\\evil.example", "/\\\\evil.example", "/%5Cevil.example", "///evil.example", "/@evil.example", "/https://evil.example", "/.//evil.example", "/\t/evil.example"];

  it("never leaves the Kajabi host for a fallback redirect", () => {
    for (const pathname of attempts) {
      const d = decideRoute(root(pathname, "?next=//evil.example"));
      if (d.action !== "redirect") throw new Error(`${pathname} was not redirected`);
      expect(new URL(d.location).host, pathname).toBe(new URL(KAJABI).host);
    }
  });

  it("never leaves the app host for a hand-over", () => {
    for (const pathname of ["/dashboard//evil.example", "/dashboard/\\evil.example", "/login//evil.example"]) {
      const d = decideRoute(root(pathname));
      if (d.action !== "redirect") throw new Error(`${pathname} was not redirected`);
      expect(new URL(d.location).host, pathname).toBe(new URL(APP_URL).host);
    }
  });

  it("never leaves the root host for an alias redirect", () => {
    for (const pathname of attempts) {
      const d = decideRoute({ host: SITE_ALIAS_HOSTS[0], method: "GET", pathname, search: "" });
      if (d.action !== "redirect") throw new Error(`${pathname} was not redirected`);
      expect(new URL(d.location).host, pathname).toBe(ROOT_HOST);
    }
  });

  it("sameLocation keeps a protocol-relative path a path, and falls back to the front page for one that cannot be a URL", () => {
    expect(sameLocation(KAJABI, "//evil.example", "")).toBe(`${KAJABI}//evil.example`);
    expect(sameLocation(KAJABI, "no-leading-slash", "?a=1")).toBe(`${KAJABI}/no-leading-slash?a=1`);
    expect(sameLocation(KAJABI, "/ok", "?a=1 b")).toBe(`${KAJABI}/ok?a=1%20b`);
  });
});

describe("explicit redirects", () => {
  const base: RoutingConfig = {
    ...DEFAULT_ROUTING,
    redirects: [
      { from: "/old/:rest*", to: "/dashboard/:rest*" },
      { from: "/old/exact", to: "https://elsewhere.example/target?from=root", permanent: true },
      { from: "/privacy", to: "/somewhere-else" },
      { from: "/library", to: "https://other.example/books" },
      { from: "/login", to: "/login", overridesHub: true },
      { from: "/dashboard", to: "/not-used", overridesHub: false },
    ],
  };

  it("wins over the Kajabi fallback, 307 by default, replacing the marker and keeping the query", () => {
    expect(decideRoute(root("/old/a/b", "?utm_source=x"), base)).toEqual({ action: "redirect", location: `${APP_URL}/dashboard/a/b?utm_source=x`, status: 307 });
    expect(decideRoute(root("/old"), base)).toEqual({ action: "redirect", location: `${APP_URL}/dashboard`, status: 307 });
  });

  it("is first-match-wins and 308 only when the entry says permanent, with its own query first", () => {
    expect(decideRoute(root("/old/exact", "?a=1"), { ...base, redirects: [base.redirects[1], base.redirects[0]] })).toEqual({
      action: "redirect",
      location: "https://elsewhere.example/target?from=root&a=1",
      status: 308,
    });
    expect(decideRoute(root("/old/exact"), base)).toEqual({ action: "redirect", location: `${APP_URL}/dashboard/exact`, status: 307 });
  });

  it("does not shadow a page the Hub serves on the root host, nor a signed-in Hub path, unless overridesHub", () => {
    expect(decideRoute(root("/privacy"), base)).toEqual({ action: "pass", host: "root" });
    expect(decideRoute(root("/dashboard"), base)).toEqual(hub("/dashboard"));
    expect(decideRoute(root("/login"), base)).toEqual(hub("/login"));
  });

  it("applies to an old Kajabi path", () => {
    expect(decideRoute(root("/library"), base)).toEqual({ action: "redirect", location: "https://other.example/books", status: 307 });
  });

  it("is seeded with /login going to the Hub login, overriding the Hub route on purpose", () => {
    expect(ROOT_REDIRECTS).toContainEqual(expect.objectContaining({ from: "/login", overridesHub: true }));
    expect(ROOT_REDIRECTS.every((r) => !r.permanent)).toBe(true);
  });

  it("only applies on the root host", () => {
    expect(decideRoute({ host: new URL(APP_URL).host, method: "GET", pathname: "/library", search: "" }, base)).toEqual({ action: "pass", host: "app" });
  });

  it("matches exact paths and rest-of-path prefixes", () => {
    expect(matchRedirect("/a", "/a")).toEqual({ rest: "" });
    expect(matchRedirect("/a", "/a/")).toBeNull();
    expect(matchRedirect("/a/:r*", "/a")).toEqual({ rest: "" });
    expect(matchRedirect("/a/:r*", "/a/b/c")).toEqual({ rest: "b/c" });
    expect(matchRedirect("/a/:r*", "/ab")).toBeNull();
    expect(fillTarget("/x/:r*", "b/c")).toBe("/x/b/c");
    expect(fillTarget("/x/:r*", "")).toBe("/x");
    expect(fillTarget("/x", "ignored")).toBe("/x");
  });
});

describe("small helpers", () => {
  it("normalizes hosts and finds the first segment", () => {
    expect(normalizeHost(" WWW.Example.COM:8080 ")).toBe("www.example.com");
    expect(normalizeHost("example.com.")).toBe("example.com");
    expect(normalizeHost(null)).toBe("");
    expect(firstSegment("/")).toBe("");
    expect(firstSegment("/a/b")).toBe("a");
    expect(firstSegment("")).toBe("");
  });

  it("knows the root host", () => {
    expect(isRootHost(ROOT_HOST)).toBe(true);
    expect(isRootHost(`${ROOT_HOST}:443`)).toBe(true);
    expect(isRootHost(new URL(APP_URL).host)).toBe(false);
    expect(isRootHost(null)).toBe(false);
  });
});

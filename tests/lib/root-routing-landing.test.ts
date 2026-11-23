/**
 * A published landing page at the bare address on the root host (`/<slug>`), and `/p/<slug>` as the route behind it
 * (src/lib/root-routing.ts, decideRoute and resolveLandingRoute): what is a candidate, what is never looked up, and that a page
 * that is not published, or a lookup that fails, gives exactly the Kajabi redirect it gave before.
 */
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_ROUTING, decideRoute, resolveLandingRoute, type LandingCandidate, type RouteRequest, type RoutingConfig } from "@/lib/root-routing";
import { APP_URL, KAJABI_SITE_URL, ROOT_HOST, SITE_ALIAS_HOSTS, SITE_URL } from "@/lib/config";
import { RESERVED_SLUGS } from "@/lib/landing/slug";

// The state after the cutover (config/app.ts publicSiteLive true); the state before it is in tests/lib/public-site-flag.test.ts and the "not live" tests it lists.
vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.liveConfigModule()));

const KAJABI = new URL(KAJABI_SITE_URL).origin;
const kajabi = (rest: string) => ({ action: "redirect", location: `${KAJABI}${rest}`, status: 307 });
const root = (pathname: string, search = ""): RouteRequest => ({ host: ROOT_HOST, method: "GET", pathname, search });

const candidate = (pathname: string, search = ""): LandingCandidate => {
  const d = decideRoute(root(pathname, search));
  if (d.action !== "landing-page") throw new Error(`${pathname} is not a landing page candidate: ${JSON.stringify(d)}`);
  return d;
};

describe("which paths can be a landing page", () => {
  it("makes a single valid segment a candidate, with the Kajabi redirect as its fallback", () => {
    expect(candidate("/ada-example-challenge", "?utm_source=x")).toEqual({
      action: "landing-page",
      slug: "ada-example-challenge",
      form: "short",
      slash: false,
      search: "?utm_source=x",
      fallback: kajabi("/ada-example-challenge?utm_source=x"),
    });
    expect(candidate("/free-trial/")).toMatchObject({ slug: "free-trial", slash: true, fallback: kajabi("/free-trial/") });
  });

  it("makes /p/<slug> a candidate whose fallback is the route itself (its 404)", () => {
    expect(candidate("/p/spring", "?a=1")).toMatchObject({ slug: "spring", form: "prefixed", slash: false, search: "?a=1", fallback: { action: "pass", host: "root" } });
    expect(candidate("/p/spring/")).toMatchObject({ slug: "spring", form: "prefixed", slash: true });
  });

  it("never asks about a path that cannot be a page address: uppercase, double dash, too long, encoded, nested", () => {
    const tooLong = `/${"a".repeat(81)}`;
    for (const path of ["/Spring", "/spring--sale", "/-spring", "/spring-", "/spring_x", tooLong, "/%73pring", "/a/b", "/a/b/", "//spring", "/spring%2F", "/spring.html"]) {
      expect(decideRoute(root(path)), path).toEqual(kajabi(path));
    }
    for (const path of ["/p/Spring", "/p/spring--x", `/p${tooLong}`, "/p/a/b", "/p/admin", "/p/new", "/p/"]) {
      expect(decideRoute(root(path)), path).toEqual({ action: "pass", host: "root" });
    }
  });

  it("never asks about a reserved address: it is a real path, or the editor's", () => {
    for (const slug of RESERVED_SLUGS) expect(decideRoute(root(`/${slug}`)).action, slug).not.toBe("landing-page");
  });

  it("lets everything the root host already claims win: the homepage, served and Hub paths, platform paths, explicit redirects", () => {
    for (const path of ["/", "/privacy", "/w", "/api", "/robots.txt", "/sitemap.xml", "/dashboard", "/login"]) {
      expect(decideRoute(root(path)).action, path).not.toBe("landing-page");
    }
    const withEntry: RoutingConfig = { ...DEFAULT_ROUTING, redirects: [{ from: "/spring", to: "https://other.example/spring" }] };
    expect(decideRoute(root("/spring"), withEntry)).toEqual({ action: "redirect", location: "https://other.example/spring", status: 307 });
  });

  it("does not look at pages on the app host or an alias", () => {
    expect(decideRoute({ host: new URL(APP_URL).host, method: "GET", pathname: "/spring", search: "" })).toEqual({ action: "pass", host: "app" });
    expect(decideRoute({ host: SITE_ALIAS_HOSTS[0], method: "GET", pathname: "/spring", search: "" }).action).toBe("redirect");
  });

  it("leaves /p/<slug> on the app host to the existing hand-over to the root host", () => {
    expect(decideRoute({ host: new URL(APP_URL).host, method: "GET", pathname: "/p/spring", search: "?a=1" })).toEqual({
      action: "redirect",
      location: `${SITE_URL}/p/spring?a=1`,
      status: 307,
    });
    for (const host of ["hub-git-branch-example.vercel.app", "localhost:3000"]) {
      expect(decideRoute({ host, method: "GET", pathname: "/p/spring", search: "" })).toEqual({ action: "pass", host: "app" });
    }
  });
});

describe("resolveLandingRoute", () => {
  const published = async () => true;
  const unpublished = async () => false;

  it("serves a published page at its address by rewriting to the route behind it", async () => {
    expect(await resolveLandingRoute(candidate("/spring", "?a=1"), published)).toEqual({ action: "rewrite", pathname: "/p/spring", host: "root" });
  });

  it("asks about the slug only", async () => {
    const ask = vi.fn(async () => true);
    await resolveLandingRoute(candidate("/spring/", "?a=1"), ask);
    expect(ask).toHaveBeenCalledExactlyOnceWith("spring");
  });

  it("falls through to Kajabi (307, path and query kept) when the page is not published", async () => {
    expect(await resolveLandingRoute(candidate("/spring/", "?a=1"), unpublished)).toEqual(kajabi("/spring/?a=1"));
  });

  it("falls through to Kajabi when the lookup fails, however it fails", async () => {
    const rejects = async () => {
      throw new Error("database down");
    };
    const throws = () => {
      throw new Error("no key");
    };
    expect(await resolveLandingRoute(candidate("/spring"), rejects)).toEqual(kajabi("/spring"));
    expect(await resolveLandingRoute(candidate("/spring"), throws as unknown as () => Promise<boolean>)).toEqual(kajabi("/spring"));
  });

  it("drops a trailing slash on a page with 308, keeping the query", async () => {
    expect(await resolveLandingRoute(candidate("/spring/", "?a=1"), published)).toEqual({ action: "redirect", location: `${SITE_URL}/spring?a=1`, status: 308 });
  });

  it("sends /p/<slug> to /<slug> with 308 when the page is published, keeping the query", async () => {
    expect(await resolveLandingRoute(candidate("/p/spring", "?a=1"), published)).toEqual({ action: "redirect", location: `${SITE_URL}/spring?a=1`, status: 308 });
    expect(await resolveLandingRoute(candidate("/p/spring/"), published)).toEqual({ action: "redirect", location: `${SITE_URL}/spring`, status: 308 });
  });

  it("leaves /p/<slug> to the route (a 404) when no page is published or the lookup fails", async () => {
    expect(await resolveLandingRoute(candidate("/p/spring"), unpublished)).toEqual({ action: "pass", host: "root" });
    expect(await resolveLandingRoute(candidate("/p/spring"), async () => Promise.reject(new Error("x")))).toEqual({ action: "pass", host: "root" });
  });

  it("gives the page `home` the address / only", async () => {
    expect(await resolveLandingRoute(candidate("/home"), published)).toEqual({ action: "redirect", location: `${SITE_URL}/`, status: 308 });
    expect(await resolveLandingRoute(candidate("/p/home", "?a=1"), published)).toEqual({ action: "redirect", location: `${SITE_URL}/?a=1`, status: 308 });
    expect(await resolveLandingRoute(candidate("/home"), unpublished)).toEqual(kajabi("/home"));
  });
});

/**
 * src/proxy.ts while the public site is NOT live (config/app.ts `publicSiteLive` false, the state until the cutover): the Hub host
 * answers exactly as it did before the root-host work, and the root and www hosts, which are Kajabi's today and never reach this
 * app, are inert if a request with that Host header ever did.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { APP_URL, publicSite } from "@/lib/config";

vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.notLiveConfigModule()));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const getUser = vi.fn(async () => ({ data: { user: null } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: () => getUser(), getSession: async () => ({ data: { session: null } }) } }),
}));
// Nothing here may look at landing pages or read a database.
const isPublished = vi.fn(async () => true);
vi.mock("@/lib/landing/published-addresses", () => ({ isPublishedAddress: () => isPublished() }));

import { proxy } from "@/proxy";

const APP_HOST = new URL(APP_URL).host;
const ROOT_HOST = publicSite(true).ROOT_HOST;
const call = (host: string, pathAndQuery: string) => proxy(new NextRequest(`http://${host}${pathAndQuery}`, { headers: { host } }));
const locationPath = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!).pathname : null);

beforeEach(() => {
  getUser.mockClear();
  isPublished.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("the Hub host while the public site is not live", () => {
  it("serves /p/<slug>, /w/<handle> and the writers' sitemap itself, signed out, with no redirect to another host", async () => {
    for (const p of ["/p/spring?a=1", "/w/ada-example", "/w/sitemap/0.xml", "/privacy"]) {
      const res = await call(APP_HOST, p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("location"), p).toBeNull();
      expect(res.headers.get("x-middleware-rewrite"), p).toBeNull();
    }
  });

  it("sends a signed-out visitor to /login from / and from a member page, as before", async () => {
    for (const p of ["/", "/dashboard", "/library"]) {
      const res = await call(APP_HOST, p);
      expect(locationPath(res), p).toBe("/login");
    }
    expect(getUser).toHaveBeenCalled();
  });

  it("serves /login itself", async () => {
    const res = await call(APP_HOST, "/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves a trailing slash to Next (the proxy does not 308 it), and asks for no landing page", async () => {
    const res = await call(APP_HOST, "/p/spring/");
    expect(res.status).not.toBe(308);
    expect(isPublished).not.toHaveBeenCalled();
  });

  it("carries the same enforced policy header as ever", async () => {
    expect((await call(APP_HOST, "/login")).headers.get("content-security-policy")).toBeTruthy();
  });
});

describe("the root host while the public site is not live", () => {
  it("treats it like any other host: no redirect to Kajabi, to the Hub or from www, and the session is checked as on the Hub", async () => {
    for (const host of [ROOT_HOST, ...publicSite(true).SITE_ALIAS_HOSTS]) {
      for (const p of ["/products/example", "/some-page", "/dashboard"]) {
        const res = await call(host, p);
        expect(new URL(res.headers.get("location") ?? "http://x/").host, `${host}${p}`).not.toBe(new URL(publicSite(true).KAJABI_SITE_URL).host);
        expect(res.headers.get("x-middleware-rewrite"), `${host}${p}`).toBeNull();
      }
    }
    expect(isPublished).not.toHaveBeenCalled();
  });
});

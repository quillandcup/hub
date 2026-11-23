/**
 * src/proxy.ts on the public site's root host (quillandcup.com), its www alias, the app host and previews
 * (src/lib/root-routing.ts): what is redirected where, and that the app host keeps behaving as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { APP_URL, KAJABI_SITE_URL, ROOT_HOST, SITE_ALIAS_HOSTS, SITE_URL } from "@/lib/config";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const getUser = vi.fn(async () => ({ data: { user: null } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: () => getUser(), getSession: async () => ({ data: { session: null } }) },
  }),
}));

import { proxy } from "@/proxy";

const APP_HOST = new URL(APP_URL).host;

function call(host: string, pathAndQuery: string, method = "GET") {
  return proxy(new NextRequest(`http://${host}${pathAndQuery}`, { method, headers: { host } }));
}

beforeEach(() => {
  getUser.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("root host", () => {
  it("sends an old Kajabi address to the Kajabi site with 307, keeping path, case, slash and query", async () => {
    const res = await call(ROOT_HOST, "/Offers/ExAmPlE/checkout/?coupon=EXAMPLE20&utm_source=instagram&x=a%20b");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${KAJABI_SITE_URL}/Offers/ExAmPlE/checkout/?coupon=EXAMPLE20&utm_source=instagram&x=a%20b`);
  });

  it("keeps the method: a POST to an old address gets 307, not a 303 or a 302", async () => {
    const res = await call(ROOT_HOST, "/forms/example", "POST");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${KAJABI_SITE_URL}/forms/example`);
  });

  it("does not let a path change the host it redirects to", async () => {
    for (const p of ["//evil.example", "/\\evil.example", "/%5Cevil.example"]) {
      const res = await call(ROOT_HOST, p);
      expect(new URL(res.headers.get("location")!).host, p).toBe(new URL(KAJABI_SITE_URL).host);
    }
  });

  it("sends a signed-out visitor on a signed-in Hub path to the app host, not to /login on this host", async () => {
    const res = await call(ROOT_HOST, "/dashboard?utm_source=email");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${APP_URL}/dashboard?utm_source=email`);
  });

  it("sends /login to the Hub login", async () => {
    const res = await call(ROOT_HOST, "/login?x=1");
    expect(res.headers.get("location")).toBe(`${APP_URL}/login?x=1`);
  });

  it("lets the homepage and the public pages through without any sign-in check", async () => {
    for (const p of ["/", "/privacy", "/w/ada-example", "/p/spring", "/robots.txt", "/api/health", "/monitoring"]) {
      const res = await call(ROOT_HOST, p);
      expect(res.headers.get("location"), p).toBeNull();
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-security-policy"), p).toBeTruthy();
    }
    expect(getUser).not.toHaveBeenCalled();
  });

  it("drops a trailing slash on a page it serves, with 308 like the Hub does", async () => {
    const res = await call(ROOT_HOST, "/privacy/?a=1");
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/privacy?a=1");
  });
});

describe("www", () => {
  it("redirects to the root host with 307, same path and query", async () => {
    const res = await call(SITE_ALIAS_HOSTS[0], "/library/categories/example?utm_source=instagram");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${SITE_URL}/library/categories/example?utm_source=instagram`);
  });
});

describe("app host and previews", () => {
  it("still sends a signed-out visitor to /login and does not send unknown paths to Kajabi", async () => {
    for (const host of [APP_HOST, "hub-git-example.vercel.app", "localhost:3000"]) {
      for (const p of ["/dashboard", "/library", "/"]) {
        const res = await call(host, p);
        expect(new URL(res.headers.get("location")!).pathname, `${host}${p}`).toBe("/login");
      }
    }
    expect(getUser).toHaveBeenCalled();
  });

  it("serves the public pages signed out", async () => {
    expect((await call(APP_HOST, "/privacy")).headers.get("location")).toBeNull();
  });

  it("drops a trailing slash with 308 as Next did before skipTrailingSlashRedirect was set", async () => {
    const res = await call(APP_HOST, "/dashboard/?tab=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`http://${APP_HOST}/dashboard?tab=1`);
  });
});

/**
 * src/proxy.ts: a published landing page is served at the bare address on the root host (`/<slug>`, rewritten to /p/<slug>), and a
 * page that is not published, or a lookup that fails, gets the Kajabi redirect it always got (src/lib/root-routing.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { APP_URL, KAJABI_SITE_URL, ROOT_HOST, SITE_URL } from "@/lib/config";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const getUser = vi.fn(async () => ({ data: { user: null } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: () => getUser(), getSession: async () => ({ data: { session: null } }) } }),
}));

const isPublished = vi.fn(async (slug: string) => slug === "ada-example-challenge" || slug === "home");
vi.mock("@/lib/landing/published-addresses", () => ({ isPublishedAddress: (slug: string) => isPublished(slug) }));

import { proxy } from "@/proxy";

const APP_HOST = new URL(APP_URL).host;
const call = (host: string, pathAndQuery: string, method = "GET") => proxy(new NextRequest(`http://${host}${pathAndQuery}`, { method, headers: { host } }));

/** Next marks a rewrite with this response header; its value is the path now served. */
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

beforeEach(() => {
  isPublished.mockClear();
  getUser.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("root host: a published page at /<slug>", () => {
  it("serves it from /p/<slug>, keeping the query, with no redirect and no sign-in check", async () => {
    const res = await call(ROOT_HOST, "/ada-example-challenge?utm_source=x");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(rewrittenTo(res)!).pathname + new URL(rewrittenTo(res)!).search).toBe("/p/ada-example-challenge?utm_source=x");
    expect(res.headers.get("content-security-policy-report-only")).toBeTruthy();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("drops a trailing slash with 308", async () => {
    const res = await call(ROOT_HOST, "/ada-example-challenge/?a=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${SITE_URL}/ada-example-challenge?a=1`);
  });

  it("sends /p/<slug> to /<slug> with 308, and /p/home and /home to the front page", async () => {
    const res = await call(ROOT_HOST, "/p/ada-example-challenge?a=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${SITE_URL}/ada-example-challenge?a=1`);
    for (const p of ["/p/home", "/home"]) {
      const home = await call(ROOT_HOST, p);
      expect(home.status, p).toBe(308);
      expect(home.headers.get("location"), p).toBe(`${SITE_URL}/`);
    }
  });
});

describe("root host: no published page there", () => {
  it("sends a draft, taken-down, template, deleted or never-made address to Kajabi with 307, path and query kept", async () => {
    for (const p of ["/some-draft?a=1", "/some-template", "/free-trial/", "/never-made"]) {
      const res = await call(ROOT_HOST, p);
      expect(res.status, p).toBe(307);
      expect(res.headers.get("location"), p).toBe(`${KAJABI_SITE_URL}${p}`);
      expect(rewrittenTo(res), p).toBeNull();
    }
  });

  it("does the same when the lookup fails", async () => {
    isPublished.mockRejectedValueOnce(new Error("database down"));
    const res = await call(ROOT_HOST, "/ada-example-challenge");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${KAJABI_SITE_URL}/ada-example-challenge`);
  });

  it("serves the 404 of /p/<slug> for an unpublished page (no redirect)", async () => {
    const res = await call(ROOT_HOST, "/p/some-draft");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(rewrittenTo(res)).toBeNull();
  });

  it("does not look up an invalid, reserved or nested address, nor one something else owns", async () => {
    const paths = ["/Spring", "/spring--x", `/${"a".repeat(81)}`, "/%73pring", "/a/b", "/new", "/events", "/dashboard", "/privacy", "/w", "/api/health", "/robots.txt", "/sitemap.xml", "/", "/login"];
    for (const p of paths) await call(ROOT_HOST, p);
    expect(isPublished).not.toHaveBeenCalled();
  });

  it("keeps the old Kajabi redirects exactly, for the methods that can reach one", async () => {
    const res = await call(ROOT_HOST, "/forms/example", "POST");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${KAJABI_SITE_URL}/forms/example`);
  });
});

describe("app host and previews", () => {
  it("still send /p/<slug> where they did: the app host hands it to the root host (307), previews and localhost serve it", async () => {
    const res = await call(APP_HOST, "/p/ada-example-challenge?a=1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${SITE_URL}/p/ada-example-challenge?a=1`);
    for (const host of ["hub-git-example.vercel.app", "localhost:3000"]) {
      const preview = await call(host, "/p/ada-example-challenge");
      expect(preview.headers.get("location"), host).toBeNull();
      expect(rewrittenTo(preview), host).toBeNull();
    }
    expect(isPublished).not.toHaveBeenCalled();
  });

  it("do not serve /<slug> as a page", async () => {
    const res = await call(APP_HOST, "/ada-example-challenge");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(isPublished).not.toHaveBeenCalled();
  });
});

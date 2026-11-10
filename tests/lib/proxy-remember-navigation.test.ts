/**
 * The proxy's `hub_next` cookie, "where they were headed" (lib/safe-next.ts), is one slot per browser and the last write wins. A
 * real sign-in went wrong because of that: a visitor signed out in one tab and clicked a Slack link to a chat message in another,
 * and a background request from the first tab, a plain `GET /` a second later, overwrote the remembered message, so the magic link
 * took them to the dashboard. Only a real page navigation may write it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => {
      const chain = { select: () => chain, insert: async () => ({}), eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
      return chain;
    },
  }),
}));

import { proxy } from "@/proxy";
import { NEXT_PATH_COOKIE } from "@/lib/safe-next";

const SLACK_LINK = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";

const visit = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: init.headers }));
const remembered = (res: Response) => {
  const cookie = (res as unknown as { cookies: { get(name: string): { value: string } | undefined } }).cookies.get(NEXT_PATH_COOKIE);
  return cookie ? decodeURIComponent(cookie.value) : null;
};
const goesToLogin = (res: Response) => new URL(res.headers.get("location") as string).pathname === "/login";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("what the proxy remembers when it sends a signed-out visitor to sign in", () => {
  it("remembers a link followed from another app, as the browser reports it (a navigation to a document)", async () => {
    const res = await visit(SLACK_LINK, { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" } });

    expect(goesToLogin(res)).toBe(true);
    expect(remembered(res)).toBe(SLACK_LINK);
  });

  it("doesn't let the bare root, which a signed-out tab asks for in the background, overwrite it", async () => {
    const res = await visit("/", { headers: { "sec-fetch-mode": "same-origin" } });
    expect(goesToLogin(res)).toBe(true);
    expect(remembered(res)).toBeNull();

    // Even as a plain navigation (a bookmark of the home page): there is nothing to come back to.
    expect(remembered(await visit("/", { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }))).toBeNull();
  });

  it.each([
    ["an RSC fetch", { rsc: "1" }, "GET"],
    ["a router prefetch", { "next-router-prefetch": "1", rsc: "1" }, "GET"],
    ["a segment prefetch", { "next-router-segment-prefetch": "/_tree", rsc: "1" }, "GET"],
    ["a background fetch", { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }, "GET"],
    ["a server action post", { "next-action": "abc123" }, "POST"],
  ])("never writes the cookie for %s, though the visitor is still sent to sign in", async (_name, headers, method) => {
    const res = await visit("/dashboard", { method, headers });

    expect(goesToLogin(res)).toBe(true);
    expect(remembered(res)).toBeNull();
  });

  it("leaves the Slack link's page in place when the background requests that follow it write nothing (the sign-in that went wrong)", async () => {
    // The browser keeps what the first response set; the later ones set nothing, so nothing replaces it.
    const jar = new Map<string, string>();
    const keep = (res: Response) => {
      const value = remembered(res);
      if (value) jar.set(NEXT_PATH_COOKIE, value);
    };

    keep(await visit("/dashboard", { headers: { "sec-fetch-mode": "same-origin" } }));
    keep(await visit(SLACK_LINK, { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }));
    keep(await visit("/", { headers: { "sec-fetch-mode": "same-origin" } }));
    keep(await visit("/projects", { headers: { rsc: "1" } }));
    keep(await visit("/my-prickles", { headers: { "next-router-prefetch": "1" } }));

    expect(jar.get(NEXT_PATH_COOKIE)).toBe(SLACK_LINK);
  });
});

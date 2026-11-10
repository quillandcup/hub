/**
 * proxy.ts → lib/supabase/middleware.ts hands the address being asked for to Server Components in a request header
 * (`x-hub-path`), so a gate decided while rendering (lib/gates.server.ts) can tell the visitor where to come back to. Next exposes
 * request headers the proxy overrides on the response as `x-middleware-request-<name>`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const state: { user: { id: string } | null; refreshCookie: { name: string; value: string } | null } = { user: null, refreshCookie: null };
const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } }) => ({
    auth: {
      getUser: async () => {
        // A token refresh: the library persists the new session cookie through setAll while the request is in flight.
        if (state.refreshCookie) options.cookies.setAll([{ ...state.refreshCookie, options: {} }]);
        return { data: { user: state.user } };
      },
      getSession: async () => ({ data: { session: state.user ? { access_token: `${b64({ alg: "ES256" })}.${b64({ sub: state.user.id, role: "authenticated", session_id: "s1" })}.sig` } : null } }),
    },
    from: () => {
      const chain = { select: () => chain, insert: async () => ({}), eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
      return chain;
    },
  }),
}));

import { proxy } from "@/proxy";

const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  state.user = { id: "user-fern" };
  state.refreshCookie = null;
});

describe("the current address handed to Server Components", () => {
  it("is the path and query of the page being opened", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1"));

    expect(forwarded(res, "x-hub-path")).toBe("/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1");
  });

  it("leaves out Next's internal _rsc marker, which a client navigation adds", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1&_rsc=abc12"));

    expect(forwarded(res, "x-hub-path")).toBe("/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1");
  });

  it("replaces a value the browser sent itself, so a client can't choose where a gate sends them back", async () => {
    const req = new NextRequest("http://localhost:3000/dashboard", { headers: { "x-hub-path": "https://evil.example.com/" } });

    expect(forwarded(await proxy(req), "x-hub-path")).toBe("/dashboard");
  });

  it("still goes along with the cookies a token refresh just set, which the pages need to see", async () => {
    state.refreshCookie = { name: "sb-session", value: "refreshed-token" };

    const res = await proxy(new NextRequest("http://localhost:3000/chat/chn_AAAAAAAAAAA1", { headers: { cookie: "sb-session=old-token" } }));

    expect(forwarded(res, "x-hub-path")).toBe("/chat/chn_AAAAAAAAAAA1");
    expect(forwarded(res, "cookie")).toContain("sb-session=refreshed-token");
    expect(forwarded(res, "cookie")).not.toContain("old-token");
  });

  it("is not set on a redirect to /login (nothing renders)", async () => {
    state.user = null;

    const res = await proxy(new NextRequest("http://localhost:3000/chat/chn_AAAAAAAAAAA1"));

    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
    expect(forwarded(res, "x-hub-path")).toBeNull();
  });
});

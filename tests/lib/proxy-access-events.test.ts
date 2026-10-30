/**
 * proxy.ts -> lib/supabase/middleware.ts: the access_events row written for every
 * signed-in request, including the browser (user agent) and GA browser ID it came from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => {
    afterCallbacks.push(fn);
  },
}));

const state: { user: { id: string } | null; insert: ReturnType<typeof vi.fn> } = {
  user: null,
  insert: vi.fn(),
};

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "ES256", typ: "JWT" })}.${b64(claims)}.sig`;
}

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      getSession: async () => ({
        data: {
          session: state.user
            ? { access_token: fakeJwt({ sub: state.user.id, session_id: "auth-session-1" }) }
            : null,
        },
      }),
    },
    from: () => ({ insert: state.insert }),
  }),
}));

import { proxy } from "@/proxy";
import { MAX_USER_AGENT_LENGTH } from "@/lib/device-label";

const USER = { id: "user-fern" };
const CHROME_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

async function visit(path: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000${path}`, { headers });
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  await proxy(req);
  for (const run of afterCallbacks.splice(0)) await run();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  state.user = USER;
  state.insert = vi.fn().mockResolvedValue({ error: null });
});

describe("access_events row from the proxy", () => {
  it("records the browser and GA browser ID the request came with", async () => {
    await visit("/dashboard", { "user-agent": CHROME_ON_MAC }, { _ga: "GA1.1.1234567890.1700000000" });

    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.insert).toHaveBeenCalledWith({
      user_id: USER.id,
      path: "/dashboard",
      is_page: false,
      session_id: "auth-session-1",
      acting_as_member_id: null,
      user_agent: CHROME_ON_MAC,
      // Parsed once, here, so the browser and device outlive the raw string (removed after 90 days).
      device: { browser: "Chrome", browser_version: "126.0", os: "macOS", os_version: null, device_type: "desktop" },
      ip_address: null,
      country: null,
      region: null,
      city: null,
      ga_client_id: "1234567890.1700000000",
    });
  });

  it("records where the request came from: the IP and Vercel's place for it", async () => {
    await visit("/dashboard", {
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "x-vercel-ip-country": "US",
      "x-vercel-ip-country-region": "IN",
      "x-vercel-ip-city": "Muncie",
    });

    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ ip_address: "203.0.113.7", country: "US", region: "IN", city: "Muncie" }));
  });

  it("records nulls when the request has no user agent or GA cookie", async () => {
    await visit("/dashboard");

    expect(state.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_agent: null, ga_client_id: null })
    );
  });

  it("caps an oversized user agent", async () => {
    await visit("/dashboard", { "user-agent": "x".repeat(MAX_USER_AGENT_LENGTH + 100) });

    expect(state.insert.mock.calls[0][0].user_agent).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it("ignores a _ga cookie that isn't GA's format", async () => {
    await visit("/dashboard", {}, { _ga: "not-a-ga-cookie" });

    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ ga_client_id: null }));
  });

  it("still serves the request when the insert fails", async () => {
    state.insert = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(visit("/dashboard")).resolves.toBeUndefined();
  });

  it("records nothing for an anonymous visitor", async () => {
    state.user = null;
    await visit("/login");

    expect(state.insert).not.toHaveBeenCalled();
  });
});

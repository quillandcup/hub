/**
 * proxy.ts → lib/supabase/middleware.ts: the optimistic /admin pre-filter.
 * Anonymous → /login (existing behaviour), signed-in non-admin → /no-access,
 * admin (sudo or not) → through. The secure check behind it is
 * requireAdminPage() (tests/components/pages/admin-auth.test.tsx).
 *
 * The role comes only from the access token's `app_role` claim (custom access
 * token hook); a missing claim is not-admin. The proxy never reads
 * user_profiles -- every test here asserts that (see afterEach).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const state: {
  user: { id: string } | null;
  getUserFails: boolean;
  profileTableReads: number;
  /** Claims in the session's access token; null = no session token. */
  tokenClaims: Record<string, unknown> | null;
} = { user: null, getUserFails: false, profileTableReads: 0, tokenClaims: null };

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "ES256", typ: "JWT" })}.${b64(claims)}.sig`;
}

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        if (state.getUserFails) throw new Error("timed out");
        return { data: { user: state.user } };
      },
      getSession: async () => ({
        data: { session: state.tokenClaims ? { access_token: fakeJwt(state.tokenClaims) } : null },
      }),
    },
    from: (table: string) => {
      if (table === "user_profiles") state.profileTableReads++;
      const chain = {
        select: () => chain,
        insert: async () => ({}),
        eq: () => chain,
        maybeSingle: async () => ({ data: { role: "admin" }, error: null }),
      };
      return chain;
    },
  }),
}));

import { proxy } from "@/proxy";
import { isAdminPath } from "@/lib/admin-paths";

const ADMIN = { id: "user-admin-bramble" };
const MEMBER = { id: "user-fern" };
const NO_CLAIM = Symbol("no app_role claim");

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000${path}`);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

/** Sign in with a token whose `app_role` claim is `appRole` (NO_CLAIM leaves it out). */
function signIn(user: { id: string } | null, appRole: unknown = NO_CLAIM) {
  state.user = user;
  state.tokenClaims = user ? { sub: user.id, role: "authenticated", session_id: "s1" } : null;
  if (user && appRole !== NO_CLAIM) state.tokenClaims = { ...state.tokenClaims, app_role: appRole };
}

/** Location path of a redirect, or null when the request passes through. */
async function redirectedTo(path: string, cookies?: Record<string, string>): Promise<string | null> {
  const res = await proxy(request(path, cookies));
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  state.getUserFails = false;
  state.profileTableReads = 0;
  signIn(null);
});

afterEach(() => {
  // The role is always the token claim: the proxy never queries user_profiles.
  expect(state.profileTableReads).toBe(0);
});

describe("proxy admin guard", () => {
  it.each(["/admin", "/admin/members", "/admin/members/m1"])("sends an anonymous visitor on %s to /login", async (path) => {
    expect(await redirectedTo(path)).toBe("/login");
  });

  it.each(["/admin", "/admin/wheel-of-wonder", "/admin/insights/prickles/weekly"])(
    "sends a member claim on %s to /no-access",
    async (path) => {
      signIn(MEMBER, "member");
      expect(await redirectedTo(path)).toBe("/no-access");
    }
  );

  it("sends an assistant claim to /no-access", async () => {
    signIn(MEMBER, "assistant");
    expect(await redirectedTo("/admin/members")).toBe("/no-access");
  });

  it("drops the admin query string on the /no-access redirect", async () => {
    signIn(MEMBER, "member");
    const res = await proxy(request("/admin/members?search=fern"));
    expect(new URL(res.headers.get("location")!).search).toBe("");
  });

  it("sends a null claim (no user_profiles row when the token was minted) to /no-access", async () => {
    signIn({ id: "user-no-profile" }, null);
    expect(await redirectedTo("/admin")).toBe("/no-access");
  });

  it("treats a token without an app_role claim as not-admin", async () => {
    signIn(ADMIN);
    expect(await redirectedTo("/admin")).toBe("/no-access");
  });

  it("treats a non-string claim as not-admin", async () => {
    signIn(ADMIN, 42);
    expect(await redirectedTo("/admin")).toBe("/no-access");
  });

  it("only trusts app_role, never the reserved role claim", async () => {
    signIn(MEMBER);
    state.tokenClaims = { ...state.tokenClaims, role: "admin" };
    expect(await redirectedTo("/admin")).toBe("/no-access");
  });

  it.each(["/admin", "/admin/members", "/admin/wheel-of-wonder"])("lets an admin claim through to %s", async (path) => {
    signIn(ADMIN, "admin");
    expect(await redirectedTo(path)).toBeNull();
  });

  it("lets an admin in sudo mode through (sudo changes the member identity, not the signed-in admin)", async () => {
    signIn(ADMIN, "admin");
    expect(await redirectedTo("/admin/members", { sudo_as: `${ADMIN.id}:member-fern:deadbeef` })).toBeNull();
  });

  it.each(["/dashboard", "/no-access", "/my-prickles", "/members/m1", "/administrivia", "/admins", "/api/admin/users"])(
    "leaves non-admin path %s alone for a member",
    async (path) => {
      signIn(MEMBER, "member");
      expect(await redirectedTo(path)).toBeNull();
    }
  );

  it("ends at /no-access for a non-admin: /admin redirects there, and /no-access itself passes through", async () => {
    // Member pages send a user with no member record to /admin; the admin side must not send them
    // back to a member page, or the two would bounce forever.
    signIn(MEMBER, "member");
    expect(await redirectedTo("/admin")).toBe("/no-access");
    expect(await redirectedTo("/no-access")).toBeNull();
  });

  it("sends an anonymous visitor on /no-access to /login", async () => {
    expect(await redirectedTo("/no-access")).toBe("/login");
  });

  it("doesn't force /login when the auth check itself fails (existing behaviour)", async () => {
    state.getUserFails = true;
    expect(await redirectedTo("/admin")).toBeNull();
  });
});

describe("remembering where a signed-out visitor was headed", () => {
  it("stores the requested path in an httpOnly cookie and sends them to a bare /login", async () => {
    const res = await proxy(request("/prickles/42?tab=notes"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    const cookie = res.cookies.get("hub_next");
    expect(cookie?.value).toBe("/prickles/42?tab=notes");
    expect(cookie?.httpOnly).toBe(true);
  });

  it("doesn't remember router prefetches", async () => {
    const req = request("/prickles/42");
    req.headers.set("next-router-prefetch", "1");
    const res = await proxy(req);
    expect(res.cookies.get("hub_next")).toBeUndefined();
  });
});

describe("isAdminPath", () => {
  it.each([
    ["/admin", true],
    ["/admin/", true],
    ["/admin/members", true],
    ["/administrivia", false],
    ["/admins", false],
    ["/dashboard/admin", false],
    ["/api/admin/users", false],
  ])("%s → %s", (path, expected) => {
    expect(isAdminPath(path)).toBe(expected);
  });
});

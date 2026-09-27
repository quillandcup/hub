/**
 * proxy.ts → lib/supabase/middleware.ts: the optimistic /admin pre-filter.
 * Anonymous → /login (existing behaviour), signed-in non-admin → /no-access,
 * admin (sudo or not) → through. The secure check behind it is
 * requireAdminPage() (tests/components/pages/admin-auth.test.tsx).
 *
 * The role comes from the access token's `app_role` claim (custom access
 * token hook) when present -- no user_profiles read -- and from a
 * user_profiles read only when the claim is absent (pre-hook tokens).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

type Role = "admin" | "member" | null;
const state: {
  user: { id: string } | null;
  role: Role;
  getUserFails: boolean;
  profileError: boolean;
  profileQueries: string[];
  profileTableReads: number;
  /** Claims in the session's access token; null = no session token. */
  tokenClaims: Record<string, unknown> | null;
} = {
  user: null,
  role: null,
  getUserFails: false,
  profileError: false,
  profileQueries: [],
  profileTableReads: 0,
  tokenClaims: null,
};

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
        eq: (_col: string, value: string) => {
          if (table === "user_profiles") state.profileQueries.push(value);
          return chain;
        },
        maybeSingle: async () =>
          state.profileError
            ? { data: null, error: { message: "boom" } }
            : { data: state.role ? { role: state.role } : null, error: null },
      };
      return chain;
    },
  }),
}));

import { proxy } from "@/proxy";
import { isAdminPath } from "@/lib/admin-paths";

const ADMIN = { id: "user-admin-bramble" };
const MEMBER = { id: "user-fern" };

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000${path}`);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

/** Signed in with a pre-hook token (no app_role claim): the role comes from user_profiles. */
function signIn(user: { id: string } | null, role: Role = null) {
  state.user = user;
  state.role = role;
  state.tokenClaims = user ? { sub: user.id, role: "authenticated", session_id: "s1" } : null;
}

/** Signed in with a token carrying `app_role` (hook enabled). `dbRole` is what user_profiles says now. */
function signInWithClaim(user: { id: string }, appRole: string | null, dbRole: Role = null) {
  signIn(user, dbRole);
  state.tokenClaims = { ...state.tokenClaims, app_role: appRole };
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
  state.profileError = false;
  state.profileQueries = [];
  state.profileTableReads = 0;
  signIn(null);
});

describe("proxy admin guard", () => {
  it.each(["/admin", "/admin/members", "/admin/members/m1"])("sends an anonymous visitor on %s to /login", async (path) => {
    expect(await redirectedTo(path)).toBe("/login");
  });

  it.each(["/admin", "/admin/wheel-of-wonder", "/admin/insights/prickles/weekly"])(
    "sends a signed-in member on %s to /no-access",
    async (path) => {
      signIn(MEMBER, "member");
      expect(await redirectedTo(path)).toBe("/no-access");
    }
  );

  it("drops the admin query string on the /no-access redirect", async () => {
    signIn(MEMBER, "member");
    const res = await proxy(request("/admin/members?search=fern"));
    expect(new URL(res.headers.get("location")!).search).toBe("");
  });

  it("sends a user with no user_profiles row to /no-access", async () => {
    signIn({ id: "user-no-profile" }, null);
    expect(await redirectedTo("/admin")).toBe("/no-access");
  });

  it.each(["/admin", "/admin/members", "/admin/wheel-of-wonder"])("lets an admin through to %s", async (path) => {
    signIn(ADMIN, "admin");
    expect(await redirectedTo(path)).toBeNull();
    expect(state.profileQueries).toEqual([ADMIN.id]);
  });

  it("lets an admin in sudo mode through (sudo changes the member identity, not the signed-in admin)", async () => {
    signIn(ADMIN, "admin");
    expect(await redirectedTo("/admin/members", { sudo_as: `${ADMIN.id}:member-fern:deadbeef` })).toBeNull();
  });

  it.each(["/dashboard", "/no-access", "/my-prickles", "/members/m1", "/administrivia", "/admins", "/api/admin/users"])(
    "leaves non-admin path %s alone for a member, without a role lookup",
    async (path) => {
      signIn(MEMBER, "member");
      expect(await redirectedTo(path)).toBeNull();
      expect(state.profileQueries).toEqual([]);
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

  it("falls through to the page-level check when the role lookup errors", async () => {
    signIn(MEMBER, "member");
    state.profileError = true;
    expect(await redirectedTo("/admin")).toBeNull();
  });

  it("doesn't force /login when the auth check itself fails (existing behaviour)", async () => {
    state.getUserFails = true;
    expect(await redirectedTo("/admin")).toBeNull();
  });
});

describe("proxy admin guard: app_role claim from the access token hook", () => {
  it.each(["/admin", "/admin/members", "/admin/wheel-of-wonder"])(
    "lets an admin claim through to %s without reading user_profiles",
    async (path) => {
      signInWithClaim(ADMIN, "admin");
      expect(await redirectedTo(path)).toBeNull();
      expect(state.profileTableReads).toBe(0);
    }
  );

  it.each([["member"], ["assistant"]])("sends a %s claim to /no-access without reading user_profiles", async (claim) => {
    signInWithClaim(MEMBER, claim);
    expect(await redirectedTo("/admin/members")).toBe("/no-access");
    expect(state.profileTableReads).toBe(0);
  });

  it("sends a null claim (no user_profiles row when the token was minted) to /no-access without a read", async () => {
    signInWithClaim({ id: "user-no-profile" }, null);
    expect(await redirectedTo("/admin")).toBe("/no-access");
    expect(state.profileTableReads).toBe(0);
  });

  it("trusts the claim over the database for this optimistic check (requireAdminPage re-reads user_profiles)", async () => {
    // Freshly demoted admin whose token hasn't refreshed yet: the proxy lets them through,
    // and the page-level check sends them to /no-access.
    signInWithClaim(ADMIN, "admin", "member");
    expect(await redirectedTo("/admin")).toBeNull();
    expect(state.profileTableReads).toBe(0);
  });

  it("lets an admin claim in sudo mode through", async () => {
    signInWithClaim(ADMIN, "admin");
    expect(await redirectedTo("/admin/members", { sudo_as: `${ADMIN.id}:member-fern:deadbeef` })).toBeNull();
    expect(state.profileTableReads).toBe(0);
  });

  it("falls back to reading user_profiles when the token has no app_role claim (minted before the hook)", async () => {
    signIn(ADMIN, "admin");
    expect(await redirectedTo("/admin")).toBeNull();
    expect(state.profileQueries).toEqual([ADMIN.id]);

    state.profileQueries = [];
    signIn(MEMBER, "member");
    expect(await redirectedTo("/admin")).toBe("/no-access");
    expect(state.profileQueries).toEqual([MEMBER.id]);
  });

  it("falls back to user_profiles when the claim isn't a string or null", async () => {
    signInWithClaim(MEMBER, null, "member");
    state.tokenClaims = { ...state.tokenClaims, app_role: 42 };
    expect(await redirectedTo("/admin")).toBe("/no-access");
    expect(state.profileQueries).toEqual([MEMBER.id]);
  });

  it("doesn't read user_profiles for a member claim on non-admin paths either", async () => {
    signInWithClaim(MEMBER, "member");
    expect(await redirectedTo("/dashboard")).toBeNull();
    expect(state.profileTableReads).toBe(0);
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

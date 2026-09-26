/**
 * proxy.ts → lib/supabase/middleware.ts: the optimistic /admin pre-filter.
 * Anonymous → /login (existing behaviour), signed-in non-admin → /no-access,
 * admin (sudo or not) → through. The secure check behind it is
 * requireAdminPage() (tests/components/pages/admin-auth.test.tsx).
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
} = { user: null, role: null, getUserFails: false, profileError: false, profileQueries: [] };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        if (state.getUserFails) throw new Error("timed out");
        return { data: { user: state.user } };
      },
      getSession: async () => ({ data: { session: null } }),
    },
    from: (table: string) => {
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

function signIn(user: { id: string } | null, role: Role = null) {
  state.user = user;
  state.role = role;
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

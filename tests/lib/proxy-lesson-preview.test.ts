/**
 * proxy.ts → lib/supabase/middleware.ts: a signed-out visit to a lesson address is rewritten to the
 * public lesson preview (title, picture and teaser for shared links); every other signed-out visit
 * to a member page still goes to /login, and a signed-in visit is untouched. The preview page
 * decides whether the lesson may be shown (tests/components/pages/lesson-preview.test.tsx).
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


const LESSON = "les_AAAAAAAAAAA1";
const LESSON_PATH = `/courses/the-ready-writer/lessons/${LESSON}`;

async function call(path: string, headers: Record<string, string> = {}) {
  const req = request(path);
  for (const [name, value] of Object.entries(headers)) req.headers.set(name, value);
  return proxy(req);
}

describe("proxy lesson preview", () => {
  it("rewrites a signed-out visit to a lesson address to the public preview, keeping the address in the browser", async () => {
    const res = await call(LESSON_PATH);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toContain(`/lesson-preview/the-ready-writer/${LESSON}`);
  });

  it("remembers the lesson as where they were headed, so signing in brings them back", async () => {
    const res = await call(`${LESSON_PATH}?t=95`);
    expect(decodeURIComponent(res.cookies.get("hub_next")?.value ?? "")).toBe(`${LESSON_PATH}?t=95`);
  });

  it("doesn't remember a router prefetch as somewhere they asked to go", async () => {
    const res = await call(LESSON_PATH, { "next-router-prefetch": "1" });
    expect(res.cookies.getAll()).toHaveLength(0);
  });

  it.each(["/courses", "/courses/the-ready-writer", "/dashboard", `/courses/the-ready-writer/lessons/${LESSON}/files/file_AAAAAAAAAAA1`, "/lesson-preview/the-ready-writer/" + LESSON])(
    "still sends a signed-out visit to %s to /login",
    async (path) => {
      expect(await redirectedTo(path)).toBe("/login");
    }
  );

  it("leaves a signed-in visit to a lesson untouched", async () => {
    signIn(MEMBER);
    const res = await call(LESSON_PATH);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("doesn't rewrite when the sign-in check timed out, so a slow check never shows a signed-in member the preview", async () => {
    state.getUserFails = true;
    const res = await call(LESSON_PATH);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });
});

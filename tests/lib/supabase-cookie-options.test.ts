/**
 * The Supabase sign-in cookies are `Secure` in a deployed build, and the browser, server and proxy clients all get the
 * same options (lib/supabase/cookie-options.ts). The library's own defaults (path, SameSite, no Domain) are not overridden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const created: { who: string; options: { cookieOptions?: Record<string, unknown> } }[] = [];

vi.mock("@supabase/ssr", () => {
  const fakeClient = {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
    },
  };
  return {
    createBrowserClient: (_url: string, _key: string, options: { cookieOptions?: Record<string, unknown> }) => {
      created.push({ who: "browser", options });
      return fakeClient;
    },
    createServerClient: (_url: string, _key: string, options: { cookieOptions?: Record<string, unknown> }) => {
      created.push({ who: "server", options });
      return fakeClient;
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
  headers: async () => new Headers(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

beforeEach(() => {
  created.length = 0;
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SUPABASE_COOKIE_OPTIONS", () => {
  it("is Secure in a deployed build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { SUPABASE_COOKIE_OPTIONS } = await import("@/lib/supabase/cookie-options");
    expect(SUPABASE_COOKIE_OPTIONS.secure).toBe(true);
  });

  it("is not Secure in local development, which runs on http://localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { SUPABASE_COOKIE_OPTIONS } = await import("@/lib/supabase/cookie-options");
    expect(SUPABASE_COOKIE_OPTIONS.secure).toBe(false);
  });

  it("only sets Secure, so the library keeps its path, SameSite and host-only defaults", async () => {
    const { SUPABASE_COOKIE_OPTIONS } = await import("@/lib/supabase/cookie-options");
    expect(Object.keys(SUPABASE_COOKIE_OPTIONS)).toEqual(["secure"]);
  });
});

describe("the three Supabase clients", () => {
  it("the browser client passes the shared options", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { createClient } = await import("@/lib/supabase/client");
    createClient();
    expect(created).toHaveLength(1);
    expect(created[0].options.cookieOptions).toEqual({ secure: true });
  });

  it("the server client passes the shared options", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();
    expect(created).toHaveLength(1);
    expect(created[0].options.cookieOptions).toEqual({ secure: true });
  });

  it("the proxy client passes the shared options", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { updateSession } = await import("@/lib/supabase/middleware");
    await updateSession(new NextRequest("https://hub.example.test/login"));
    expect(created.length).toBeGreaterThan(0);
    expect(created[0].options.cookieOptions).toEqual({ secure: true });
  });
});

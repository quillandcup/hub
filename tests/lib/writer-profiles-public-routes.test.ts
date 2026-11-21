/**
 * Who may open what without signing in. A writer's profile (/w/<handle>), its sitemaps and robots.txt are public, like /p/<slug>:
 * the route itself decides what to show. The preview of a page that is off, and settings, are not: a signed-out visitor is sent
 * to sign in. (lib/supabase/middleware.ts, docs/product/WRITER_PROFILES.md)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => {
  const fakeClient = {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
    },
  };
  return { createBrowserClient: () => fakeClient, createServerClient: () => fakeClient };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

async function visit(path: string) {
  const { updateSession } = await import("@/lib/supabase/middleware");
  return updateSession(new NextRequest(`https://hub.example.test${path}`));
}

describe("signed-out visitors", () => {
  it.each(["/w/ada-example", "/w/sitemap/0.xml", "/robots.txt", "/p/spring"])("can open %s", async (path) => {
    const response = await visit(path);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/writer-profile/preview", "/settings/profile", "/dashboard", "/wx/ada-example"])("are sent to sign in for %s", async (path) => {
    const response = await visit(path);
    expect(response.headers.get("location")).toContain("/login");
  });
});

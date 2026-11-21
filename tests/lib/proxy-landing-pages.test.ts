/**
 * src/proxy.ts → src/lib/supabase/middleware.ts: a landing page address (/p/<slug>) is open to a signed-out visitor, while the
 * editor's addresses (/admin/pages...) and every other page stay behind sign-in.
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

async function redirectedTo(path: string): Promise<string | null> {
  const res = await proxy(new NextRequest(`http://localhost:3000${path}`));
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("signed-out visits and landing pages", () => {
  it("lets a signed-out visitor open a landing page", async () => {
    expect(await redirectedTo("/p/spring-challenge")).toBeNull();
  });

  it("sends a signed-out visitor from the page editor, its preview and the list to sign in", async () => {
    expect(await redirectedTo("/admin/pages")).toBe("/login");
    expect(await redirectedTo("/admin/pages/spring-challenge")).toBe("/login");
    expect(await redirectedTo("/admin/pages/spring-challenge/preview")).toBe("/login");
  });

  it("does not open anything else that merely starts with p", async () => {
    expect(await redirectedTo("/prickles")).toBe("/login");
    expect(await redirectedTo("/projects")).toBe("/login");
  });
});

/**
 * Who may open the Bookshelf without signing in (src/lib/public-bookshelf.ts, src/lib/supabase/middleware.ts): a signed-out visit to
 * /bookshelf is rewritten to the public page, a signed-in visit is left to the member page, /sitemap.xml is open, and every other
 * member page still goes to sign in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NONCE_HEADER } from "@/lib/csp";
import { CURRENT_PATH_HEADER } from "@/lib/gates";
import { PUBLIC_BOOKSHELF_RENDER_PATH, publicBookshelfDocument, publicBookshelfRewrite } from "@/lib/public-bookshelf";
import { BOOKSHELF_DEFAULT_FIRST_SHOWN, BOOKSHELF_MAX_BOOKS } from "@/modules/bookshelf/page-blocks/live-books";

const auth: { user: { id: string } | null } = { user: null };

vi.mock("@supabase/ssr", () => {
  const fakeClient = {
    auth: {
      getUser: async () => ({ data: { user: auth.user } }),
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
  auth.user = null;
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

async function visit(path: string) {
  const { updateSession } = await import("@/lib/supabase/middleware");
  return updateSession(new NextRequest(`https://hub.example.test${path}`));
}

describe("publicBookshelfRewrite", () => {
  it("maps /bookshelf, with or without the trailing slash, and nothing else", () => {
    expect(publicBookshelfRewrite("/bookshelf")).toBe(PUBLIC_BOOKSHELF_RENDER_PATH);
    expect(publicBookshelfRewrite("/bookshelf/")).toBe(PUBLIC_BOOKSHELF_RENDER_PATH);
    expect(publicBookshelfRewrite("/bookshelf/x")).toBeNull();
    expect(publicBookshelfRewrite("/projects/books")).toBeNull();
    expect(publicBookshelfRewrite("/public-bookshelf")).toBeNull();
  });
});

describe("the proxy for a visitor who is not signed in", () => {
  it("shows the public Bookshelf at /bookshelf instead of sending them to sign in", async () => {
    const response = await visit("/bookshelf");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(`https://hub.example.test${PUBLIC_BOOKSHELF_RENDER_PATH}`);
  });

  it("hands the script nonce and the address asked for to the page it rewrites to, or Next puts no nonce on its scripts and the browser blocks them", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");
    const response = await updateSession(new NextRequest("https://hub.example.test/bookshelf?genre=x"), { [NONCE_HEADER]: "nonce-123" });
    expect(response.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe("nonce-123");
    expect(response.headers.get(`x-middleware-request-${CURRENT_PATH_HEADER}`)).toBe("/bookshelf?genre=x");
  });

  it("opens the site sitemap and robots.txt", async () => {
    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      const response = await visit(path);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it.each(["/public-bookshelf", "/bookshelf/anything", "/projects/books", "/members/mem_AAAAAAAAAAA1", "/dashboard"])("still sends them to sign in for %s", async (path) => {
    const response = await visit(path);
    expect(response.headers.get("location")).toContain("/login");
  });
});

describe("the proxy for a signed-in member", () => {
  it("leaves /bookshelf to the member page", async () => {
    auth.user = { id: "user-1" };
    const response = await visit("/bookshelf");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("the page the visitor is shown", () => {
  it("is a heading and the Hedgie Bookshelf block with no genre filter, asking for the most books one block loads", () => {
    const doc = publicBookshelfDocument();
    expect(doc.content.map((b) => b.type)).toEqual(["Hero", "HedgieBookshelf"]);
    expect(doc.content[1].props).toMatchObject({ genre: "", max: BOOKSHELF_MAX_BOOKS, firstShown: BOOKSHELF_DEFAULT_FIRST_SHOWN });
  });
});

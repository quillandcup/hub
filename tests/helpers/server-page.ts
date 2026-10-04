/**
 * Helpers for testing async App Router server-component pages (`app/**\/page.tsx`) in jsdom.
 *
 * The pattern: mock the page's data dependencies, `await` the page's default export like a plain
 * async function, then `render()` the JSX it returns. Mock client children that are heavy or need
 * browser APIs; everything else (Link, Tabs, plain markup) renders for real.
 *
 *   // @vitest-environment jsdom
 *   vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule))
 *   vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule))
 *   vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule))
 *   vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule))
 *
 *   beforeEach(() => {
 *     resetServerPageMocks()
 *     signInAs(MEMBER_USER, MEMBER_IDENTITY)
 *     useFakeSupabase({ members: { data: [...] } })
 *   })
 *
 *   it("renders", async () => {
 *     await renderServerPage(Page, { params: Promise.resolve({ id: "m1" }) })
 *     expect(screen.getByRole("heading", { name: "..." })).toBeInTheDocument()
 *   })
 *
 * The module mocks are built here (rather than inline in each test's vi.mock factory) so every page
 * test shares one definition of "what Next's redirect does" and one fake Supabase client.
 */
import { vi, expect } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode, ReactElement } from "react";
import type { AuthUser } from "@/lib/auth";
import type { EffectiveIdentity } from "@/lib/sudo";

// ---------------------------------------------------------------------------
// next/navigation
// ---------------------------------------------------------------------------

/** Like Next's real `redirect()`: throws (so code after it never runs) with a `NEXT_REDIRECT` digest. */
export const redirect = vi.fn((url: string): never => {
  throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
});

/** Like Next's real `notFound()`: throws with the 404 fallback digest. */
export const notFound = vi.fn((): never => {
  throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
});

export const routerMock = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

export const nextNavigationModule = {
  redirect,
  notFound,
  useRouter: () => routerMock,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
};

// ---------------------------------------------------------------------------
// Auth + sudo identity
// ---------------------------------------------------------------------------

export const getCurrentUser = vi.fn<() => Promise<AuthUser | null>>();
export const getEffectiveIdentity = vi.fn<(user: AuthUser) => Promise<EffectiveIdentity | null>>();

export const authModule = { getCurrentUser };
export const sudoModule = { getEffectiveIdentity };

export const MEMBER_USER: AuthUser = { id: "user-fern", email: "fern.quillsby@example.test" };
export const MEMBER_IDENTITY: EffectiveIdentity = {
  memberId: "member-fern",
  memberName: "Fern Quillsby",
  memberEmail: "fern.quillsby@example.test",
  isSudo: false,
};
export const ADMIN_USER: AuthUser = { id: "user-admin-bramble", email: "bramble.admin@example.test" };

/** Signs in `user` and resolves their effective (possibly sudo'd) member identity. Pass
 * `identity: null` for an admin with no member record. */
export function signInAs(user: AuthUser | null, identity: EffectiveIdentity | null = null) {
  getCurrentUser.mockResolvedValue(user);
  getEffectiveIdentity.mockResolvedValue(identity);
}

// ---------------------------------------------------------------------------
// Fake Supabase server client
// ---------------------------------------------------------------------------

export interface FakeQuery {
  /** Table name, prefixed with the schema for `.schema("bronze").from(...)` (e.g. "bronze.slack_users"). */
  table: string;
  calls: { method: string; args: unknown[] }[];
}

export interface FakeResponse {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

/** Per-table canned responses: a fixed response, or a function of the recorded query (to vary by
 * filter). Tables not listed resolve to `{ data: [] }` (or `null` after `.single()`). */
export type FakeTables = Record<string, FakeResponse | ((query: FakeQuery) => FakeResponse)>;

/**
 * A chainable stand-in for the Supabase query builder: every builder method (`select`, `eq`, `in`,
 * `order`, ...) records itself and returns the builder, and awaiting it resolves the table's canned
 * response. `.range(from, to)` slices array data so the repo's pagination loops terminate, and
 * `.single()`/`.maybeSingle()` unwrap to the first row.
 */
export function createFakeSupabase(tables: FakeTables = {}) {
  const queries: FakeQuery[] = [];

  function builder(table: string): unknown {
    const query: FakeQuery = { table, calls: [] };
    queries.push(query);

    const resolve = () => {
      const entry = tables[table];
      const res = (typeof entry === "function" ? entry(query) : entry) ?? {};
      const single = query.calls.some((c) => c.method === "single" || c.method === "maybeSingle");
      const range = query.calls.find((c) => c.method === "range");
      let data = res.data ?? (single ? null : []);
      if (Array.isArray(data) && range) {
        const [from, to] = range.args as [number, number];
        data = data.slice(from, to + 1);
      }
      if (single && Array.isArray(data)) data = data[0] ?? null;
      const count = res.count ?? (Array.isArray(res.data) ? res.data.length : null);
      return { data, count, error: res.error ?? null };
    };

    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve(resolve()).then(onFulfilled, onRejected);
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(prop), args });
            return proxy;
          };
        },
      }
    );
    return proxy;
  }

  return {
    queries,
    from: (table: string) => builder(table),
    schema: (schema: string) => ({ from: (table: string) => builder(`${schema}.${table}`) }),
    /** Resolves the `"rpc:<fn>"` entry of `tables`. */
    rpc: (fn: string, ...args: unknown[]) => {
      const q = builder(`rpc:${fn}`) as { args: (...a: unknown[]) => unknown };
      return q.args(...args);
    },
    auth: {
      getClaims: vi.fn(async () => ({ data: null, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;

let currentSupabase: FakeSupabase = createFakeSupabase();

/** Installs a fresh fake client for `createClient()` to return, and returns it for query assertions. */
export function useFakeSupabase(tables: FakeTables = {}): FakeSupabase {
  currentSupabase = createFakeSupabase(tables);
  return currentSupabase;
}

export const createClient = vi.fn(async () => currentSupabase);
export const supabaseServerModule = { createClient };

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Clears call history on the shared mocks and resets the fake client (implementations are kept). */
export function resetServerPageMocks() {
  redirect.mockClear();
  notFound.mockClear();
  getCurrentUser.mockReset();
  getEffectiveIdentity.mockReset();
  createClient.mockClear();
  currentSupabase = createFakeSupabase();
}

/** Awaits an async server-component page and renders its JSX into the jsdom document. */
export async function renderServerPage<P>(
  Page: (props: P) => Promise<ReactNode> | ReactNode,
  props: P
): Promise<ReturnType<typeof render>> {
  const ui = await Page(props);
  return render(ui as ReactElement);
}

/**
 * Like renderServerPage, for a thin route page that returns one async server component (e.g. a
 * path-based tab route returning `<MyPricklesPage tab="all" />`, lib/tab-routes.ts): awaits the
 * route, then that component, and renders the result.
 */
export async function renderServerRoute<P>(
  Route: (props: P) => Promise<ReactNode> | ReactNode,
  props: P
): Promise<ReturnType<typeof render>> {
  const element = (await Route(props)) as ReactElement<Record<string, unknown>>;
  const Component = element.type as (props: Record<string, unknown>) => Promise<ReactNode> | ReactNode;
  return renderServerPage(Component, element.props);
}

/** Asserts the page redirects to `url` (via the mocked `redirect()`) instead of rendering. */
export async function expectRedirect<P>(
  Page: (props: P) => Promise<ReactNode> | ReactNode,
  props: P,
  url: string
): Promise<void> {
  await expect(Promise.resolve().then(() => Page(props))).rejects.toMatchObject({
    digest: `NEXT_REDIRECT;replace;${url};307;`,
  });
  expect(redirect).toHaveBeenCalledWith(url);
}

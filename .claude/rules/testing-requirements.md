---
paths:
  - "tests/**"
  - "supabase/tests/**"
  - "config/vitest.mts"
  - "src/app/api/process/**"
  - "src/app/api/import/**"
  - "src/app/api/reconcile/**"
---

### Testing Requirements

**RULE**: Critical data processing routes must have integration tests.

Required test coverage:
- `/api/process/calendar` - Test with >1000 events
- `/api/process/attendance` - Test with >1000 records
- `/api/sync/calendar` - Test pagination

**API route tests**: `tests/api/**` call route handlers in-process with `apiFetch` from `tests/helpers/api-fetch.ts`, a drop-in for `fetch(`${getTestApiBaseUrl()}/api/...`)` that finds the `src/app/api/**/route.ts` for the path, builds a `NextRequest` and calls the handler, so Vitest's coverage counts the route (a request to the separate `next start` server is invisible to v8). It serves `cookies()`/`headers()` from the request, so cookie-auth routes work; it skips `src/proxy.ts`, which leaves `/api/*` public (routes authenticate themselves), and the proxy has its own tests. Don't `fetch` the app server from a new test; the only HTTP tests are the few in `tests/api/smoke/` (their own Vitest project: `pnpm test:smoke`, against the built app, which CI runs after the rest of the db suite while the production build is still going), for Next's own routing and body parsing. Routes answer a malformed JSON body with 400: read it with `await request.json().catch(() => undefined)` and return the 400 on `undefined`, not a bare `await request.json()`.

**Component tests**: React Testing Library is available for interactive components (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`). Put `.tsx` test files under `tests/components/`, with `// @vitest-environment jsdom` as the first line. Prefer rendering the component and asserting on the DOM (`render` + `userEvent`/`fireEvent` + `screen`) over the older pattern in some `tests/components/*.test.ts` files of `fs.readFileSync`-ing the source and asserting `expect(src).toContain(...)` — that pattern doesn't verify behavior. See `tests/components/SortableTh.test.tsx` and `tests/components/MembersTable.test.tsx` for the current example.

**SQL tests (pgTAP)**: RLS policies, `SECURITY DEFINER` functions and auth hooks — anything only observable as a particular Postgres role — go in `supabase/tests/database/*.test.sql`. Each file wraps itself in `BEGIN … ROLLBACK`, creates the `pgtap` extension, and ends with `SELECT * FROM finish(true);` so a failed assertion raises. Keep `plan(N)` equal to the assertions that run: pgTAP's `finish(true)` stays silent when they differ, so the runner also fails a file whose output has a `not ok` (other than `# TODO`) or `# Looks like you planned`. Count a test file's rows in the shared local database out of your assertions (scope counts to your own ids), because CI's database holds rows from earlier tests. `pnpm test:pgtap` (`scripts/test-pgtap.sh`) runs them all as `supabase_admin` against the local stack; CI runs it in the test-db job.

**Server-component page tests**: Async `page.tsx` files are tested the same way — `await` the page's default export with its props (e.g. `{ searchParams: Promise.resolve({ tab: "find" }) }`), then `render()` the returned JSX. `tests/helpers/server-page.ts` supplies the shared module mocks (point `vi.mock("next/navigation" | "@/lib/auth" | "@/lib/sudo" | "@/lib/supabase/server", ...)` at them), a chainable fake Supabase client (`useFakeSupabase({ table: { data } })`), `signInAs(user, identity)`, `renderServerPage` and `expectRedirect` (the mocked `redirect()` throws like Next's). Mock other src/lib/action calls and heavy client children per test. Put these under `tests/components/pages/`; see `tests/components/pages/unflagged-pages.test.tsx`.

**Time in tests: fake clock, never real waits**: Tests must not spend real time waiting on pauses, retries or deadlines. Server code that sleeps or keeps a time budget reads time through `src/lib/clock.ts` (`clock.now()`, `clock.sleep(ms)`), not `Date.now()`/`setTimeout` directly. Tests call `useFakeClock()` from `tests/helpers/fake-clock.ts`: `sleep` moves virtual time forward and resolves at once, and `fake.clock.advance(ms)` jumps ahead to hit a deadline or trigger a callback. See `tests/api/idempotency/slack-api-thread-selection.test.ts`. Don't use `vi.useFakeTimers()` with `runAllTimersAsync()`/`advanceTimersByTime()` in tests that make real HTTP calls (the local Supabase): it also fires the HTTP client's own timeouts on in-flight requests (`UND_ERR_HEADERS_TIMEOUT`), which fails only on slower CI. `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime()` is fine for pinning "now".

**Browser page checks**: every page a Playwright scene opens (`tests/demo/`) gets console, accessibility (axe) and overflow checks from the same helper. They run nightly, not on pull requests (the page-checks jobs of `.github/workflows/help-screenshots.yml`: two combinations nightly, all eight on Sundays), against `tests/demo/baseline.json`: a finding it does not list fails, and so does a listed one that is gone, so the file only shrinks. Open pages with `page.goto` in a scene using `tests/demo/fixtures`; run `pnpm demo:capture` locally for a page you changed. How: `docs/product/DEMO_AND_HELP.md`, "Page checks".

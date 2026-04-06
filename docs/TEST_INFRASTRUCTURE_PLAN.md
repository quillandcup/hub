# Test Infrastructure Improvement Plan

## Current Issues

### ❌ Problems with Current Setup:

1. **Shared Database State**
   - Tests use your local Supabase instance (port 54321)
   - All tests write to same database
   - Test interference: one test's data affects another
   - Manual cleanup required between test runs

2. **Manual Server Management**
   - Dev server must be running on port 3000
   - Requires manual start/stop
   - Can't run tests in CI without server setup
   - Dev server uses production config (Google Calendar, Zoom APIs)

3. **No Test Isolation**
   - Tests share reference data (prickle_types, members)
   - No cleanup between test suites
   - Race conditions possible
   - Hard to debug failures

4. **External API Dependencies**
   - Tests could accidentally call real Google Calendar API
   - Tests could call real Zoom API
   - Slow, brittle, potentially expensive
   - Can't run offline

## Industry Standard: Proper Test Setup

### ✅ What Professional Test Suites Do:

```
┌─────────────────────────────────────────────────────────────┐
│  Unit Tests (Fast, Isolated)                                │
│  - Mock everything                                          │
│  - No database, no HTTP                                     │
│  - Test pure functions and logic                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Integration Tests (Medium Speed, Controlled)               │
│  - Programmatic test server (different port)                │
│  - Isolated test database (different schema/instance)       │
│  - Mocked external APIs (Google, Zoom)                      │
│  - Clean state before each test                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  E2E Tests (Slow, Full System)                              │
│  - Real browser (Playwright)                                │
│  - Real database (staging environment)                      │
│  - Maybe real external APIs (with test accounts)            │
│  - Run in CI on every PR                                    │
└─────────────────────────────────────────────────────────────┘
```

## Recommended Architecture for This Project

### Phase 1: Quick Wins (Low Effort, High Value)

**1. Separate Test Database**
```typescript
// tests/helpers/supabase.ts
const TEST_DB_URL = 'http://127.0.0.1:54321'
const TEST_DB_SCHEMA = 'test_schema'  // Isolated schema

export function getTestSupabaseClient() {
  return createClient(TEST_DB_URL, ANON_KEY, {
    db: { schema: TEST_DB_SCHEMA }
  })
}
```

**2. Test Fixtures**
```typescript
// tests/fixtures/prickle-types.ts
export const testPrickleTypes = [
  { name: 'Morning Pages', duration: 60 },
  { name: 'Deep Work', duration: 120 },
]

// Before each test suite
await supabase.from('prickle_types').insert(testPrickleTypes)
```

**3. Programmatic Server Start**
```typescript
// vitest.config.ts
export default defineConfig({
  globalSetup: './tests/setup/global-setup.ts',
})

// tests/setup/global-setup.ts
import { spawn } from 'child_process'

let serverProcess

export async function setup() {
  // Start Next.js on port 3001 (test port)
  serverProcess = spawn('npm', ['run', 'dev', '--', '-p', '3001'], {
    env: { ...process.env, NODE_ENV: 'test' }
  })
  
  // Wait for server ready
  await waitForPort(3001)
}

export async function teardown() {
  serverProcess.kill()
}
```

### Phase 2: Mock External APIs (Medium Effort)

**Mock Google Calendar**
```typescript
// tests/mocks/google-calendar.ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const googleCalendarMocks = [
  http.get('https://www.googleapis.com/calendar/v3/calendars/:calendarId/events', () => {
    return HttpResponse.json({
      items: [
        {
          id: 'test-event-1',
          summary: 'Morning Pages',
          start: { dateTime: '2024-01-01T09:00:00Z' },
          end: { dateTime: '2024-01-01T10:00:00Z' },
        }
      ]
    })
  }),
]

export const testServer = setupServer(...googleCalendarMocks)
```

**Mock Zoom API**
```typescript
// tests/mocks/zoom.ts
export const zoomMocks = [
  http.get('https://api.zoom.us/v2/report/meetings/:meetingId/participants', () => {
    return HttpResponse.json({
      participants: [
        {
          id: 'test-participant-1',
          name: 'Test User',
          user_email: 'test@example.com',
          join_time: '2024-01-01T09:00:00Z',
          leave_time: '2024-01-01T10:00:00Z',
          duration: 60,
        }
      ]
    })
  }),
]
```

### Phase 3: Full Test Isolation (Higher Effort, Complete Solution)

**Test Database Per Suite**
```bash
# Use Supabase CLI to create isolated test projects
supabase init --workdir ./tests/supabase
supabase start --workdir ./tests/supabase --db-port 54322
```

**Transactional Tests** (Rollback after each test)
```typescript
describe('My Test Suite', () => {
  beforeEach(async () => {
    await supabase.rpc('begin_transaction')
  })
  
  afterEach(async () => {
    await supabase.rpc('rollback_transaction')
  })
})
```

## Implementation Roadmap

### Immediate (This Week)
- [x] Add seed data helper
- [ ] Create test fixtures for common reference data
- [ ] Add cleanup in afterEach hooks
- [ ] Document test isolation issues in README

### Short Term (This Month)
- [ ] Set up MSW (Mock Service Worker) for external APIs
- [ ] Add programmatic server start/stop in Vitest config
- [ ] Use separate test database schema
- [ ] Add test:integration npm script

### Long Term (Next Quarter)
- [ ] Migrate to Playwright for E2E tests
- [ ] Set up staging environment
- [ ] Add CI/CD pipeline with test database
- [ ] Implement test database seeding/migration strategy

## File Structure

```
tests/
├── fixtures/          # Test data fixtures
│   ├── members.ts
│   ├── prickle-types.ts
│   └── calendar-events.ts
├── helpers/           # Test utilities (current)
│   ├── supabase.ts
│   └── seed-data.ts
├── mocks/             # API mocks (MSW)
│   ├── google-calendar.ts
│   ├── zoom.ts
│   └── index.ts
├── setup/             # Global test setup
│   ├── global-setup.ts
│   ├── db-setup.ts
│   └── server-setup.ts
├── api/               # API route integration tests
│   ├── idempotency/
│   └── reprocessability/
└── e2e/               # End-to-end tests (Playwright)
    ├── dashboard.spec.ts
    └── import-flow.spec.ts
```

## Environment Variables

```bash
# .env.test (separate from .env.local)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54322  # Different port
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key
GOOGLE_SERVICE_ACCOUNT_KEY={"type": "service_account", ...}  # Mock/test account
ZOOM_CLIENT_ID=test-client-id
ZOOM_CLIENT_SECRET=test-secret
NODE_ENV=test
```

## Cost/Benefit Analysis

| Improvement | Effort | Impact | Priority |
|-------------|--------|--------|----------|
| Test fixtures | Low | Medium | 🔥 High |
| Separate DB schema | Low | High | 🔥 High |
| MSW for API mocks | Medium | High | ⚡ Medium |
| Programmatic server | Medium | Medium | ⚡ Medium |
| Per-suite DB isolation | High | High | 💤 Low |
| Full E2E with Playwright | High | Medium | 💤 Low |

## Next Steps

1. **Decision Point**: Do you want to implement Phase 1 now, or continue with current setup?
2. **If yes to Phase 1**: We can start with test fixtures and separate DB schema this session
3. **If no**: Document current limitations and proceed with working around them

**Recommendation**: Implement Phase 1 (Quick Wins) now - it's 1-2 hours of work for much more reliable tests.

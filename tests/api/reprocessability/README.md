# Reprocessability Integration Tests

These tests verify that all Silver layer processing routes follow the **DELETE + INSERT** pattern for full reprocessability.

## Prerequisites

**IMPORTANT**: These are integration tests that require the Next.js dev server to be running.

1. Start the dev server in one terminal:
   ```bash
   npm run dev
   ```

2. Run the tests in another terminal:
   ```bash
   npm test -- tests/api/reprocessability/
   ```

## What These Tests Verify

Each test suite verifies that its corresponding route is fully reprocessable:

### Members (`/api/process/members`)
- ✓ Creates members from Bronze on first process
- ✓ Removes deleted members when reprocessing
- ✓ Updates member status when Bronze data changes
- ✓ Uses DELETE + INSERT (not UPSERT) - orphan detection

### Calendar (`/api/process/calendar`)
- ✓ Creates prickles from calendar events
- ✓ Removes prickles for deleted events
- ✓ Adds prickles for new events
- ✓ Uses DELETE + INSERT (not selective UPDATE) - orphan detection
- ✓ Scoped by date range

### Attendance (`/api/process/attendance`)
- ✓ Creates attendance from Zoom data
- ✓ Removes attendance when Zoom data deleted
- ✓ Removes PUPs when Zoom meetings deleted
- ✓ Uses DELETE + INSERT (not UPSERT) - orphan detection
- ✓ Scoped by date range

## Why These Tests Matter

These tests prevent regressions where routes use UPSERT or selective UPDATE patterns, which violate the core architectural principle that **Silver layer must be fully regenerable from Bronze**.

The "orphan detection" test is critical - it proves the route uses DELETE + INSERT by:
1. Inserting data directly into Silver (bypassing Bronze)
2. Reprocessing from Bronze
3. Verifying the orphan is removed

If UPSERT was used, the orphan would remain, failing the test.

## Running Individual Test Suites

```bash
# Members only
npm test -- tests/api/reprocessability/members-reprocessability.test.ts

# Calendar only
npm test -- tests/api/reprocessability/calendar-reprocessability.test.ts

# Attendance only
npm test -- tests/api/reprocessability/attendance-reprocessability.test.ts
```

## Troubleshooting

**Tests fail with "fetch failed" or connection errors:**
- Ensure `npm run dev` is running on port 3000
- Check that the database is accessible (local Supabase or remote)

**Tests fail with authentication errors:**
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in `.env.local`
- The tests use the admin client to bypass RLS

**Tests fail on CI:**
- These are integration tests requiring a running server
- CI pipeline should start the dev server before running tests
- Or skip these tests in CI and run them manually before releases

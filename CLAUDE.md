# Development Guidelines for Quill & Cup Admin Portal

## Critical Architecture Rules

### Database Query Limits

**RULE**: Supabase has a default 1000-row limit per query. Always paginate when fetching potentially large datasets.

**Required patterns**:

```typescript
// ✅ CORRECT: Paginate for large tables
let allRows: any[] = [];
let offset = 0;
const BATCH_SIZE = 1000;
let hasMore = true;

while (hasMore) {
  const { data: batch } = await supabase
    .from("large_table")
    .select("*")
    .range(offset, offset + BATCH_SIZE - 1);
  
  if (batch && batch.length > 0) {
    allRows = allRows.concat(batch);
    offset += batch.length;
    hasMore = batch.length === BATCH_SIZE;
  } else {
    hasMore = false;
  }
}

// ❌ WRONG: Single query without pagination
const { data } = await supabase.from("large_table").select("*");
```

**Tables requiring pagination**:
- `calendar_events` (1300+ rows)
- `attendance` (10,000+ rows expected)
- `zoom_attendees` (large historical data)
- Any table that could exceed 1000 rows

### API Route Performance

**RULE**: Batch database operations to avoid timeouts on Vercel (300s max).

**Required patterns**:
1. Load reference data upfront with `Promise.all()`
2. Process in memory using Map/Set lookups
3. Batch writes in chunks of 100-500 with parallel execution
4. Avoid sequential database calls inside loops

### Attendance Table Design

**RULE**: The `attendance` table allows multiple records per `(member_id, prickle_id)` to track leave/rejoin patterns.

**Why**: People can leave and rejoin the same meeting/prickle (e.g., bathroom break, stepped away for a call).

**Example**:
```
Alice attends "Morning Writing" prickle:
- Record 1: join=9:00, leave=9:30 (30 min)
- Record 2: join=10:00, leave=11:00 (60 min)
Total time: 90 min (not 120 min if merged)
```

**Important queries**:
```sql
-- Count unique prickles attended (NOT count of attendance records)
SELECT COUNT(DISTINCT prickle_id) FROM attendance WHERE member_id = 'alice';

-- Total time spent
SELECT SUM(leave_time - join_time) FROM attendance WHERE member_id = 'alice';

-- Did member attend this prickle? (returns true even if multiple records)
SELECT EXISTS(SELECT 1 FROM attendance WHERE member_id = 'alice' AND prickle_id = '123');
```

**DO NOT**: Add unique constraint on `(member_id, prickle_id)` or deduplicate attendance records

### Testing Requirements

**RULE**: Critical data processing routes must have integration tests.

Required test coverage:
- `/api/process/calendar` - Test with >1000 events
- `/api/process/attendance` - Test with >1000 records
- `/api/sync/calendar` - Test pagination

## Code Review Checklist

Before committing changes to API routes, verify:

- [ ] Pagination implemented for queries that could return >1000 rows
- [ ] Database operations batched (no sequential queries in loops)
- [ ] `maxDuration` set appropriately for long-running operations
- [ ] Error handling includes logging for debugging in Vercel
- [ ] Changes tested locally with realistic data volumes

## Technology Stack

- **Framework**: Next.js 15 App Router
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel (Hobby tier: 300s timeout, limited resources)
- **Auth**: Supabase Auth (invite-only, RLS enabled)

## Data Architecture

**Bronze Layer** (raw imports):
- `calendar_events`, `zoom_attendees`, `zoom_meetings`, `kajabi_members`

**Silver Layer** (processed/canonical):
- `members`, `prickles`, `attendance`, `prickle_types`

**Gold Layer** (aggregated views):
- Currently computed on-demand in dashboard queries

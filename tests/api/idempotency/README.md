# Bronze Layer Idempotency Tests

These tests verify that all Bronze layer imports are idempotent - they can be run multiple times safely without creating unwanted duplicates or side effects.

## Running the Tests

These are unit tests that interact directly with the database (no API server required):

```bash
npm test -- tests/api/idempotency/
```

## Idempotency Patterns

### 1. Calendar Sync (`/api/sync/calendar`) - UPSERT Pattern

**Pattern**: `UPSERT by google_event_id`

**Behavior**:
- First sync creates events
- Re-syncing same events does NOT create duplicates
- Changed events are updated in place
- New events are added
- Safe for scheduled cron jobs

**Tests verify**:
- ✓ No duplicates on re-sync
- ✓ Updates work correctly
- ✓ Unique constraint prevents accidental INSERT duplicates
- ✓ Multiple sync cycles are completely idempotent

### 2. Zoom Import (`/api/import/zoom`) - UPSERT Pattern

**Pattern**: `UPSERT by (meeting_uuid, name, join_time)`

**Behavior**:
- First import creates zoom attendee records
- Re-importing same data does NOT create duplicates
- Same person can have multiple records if they rejoin (different join_time)
- Different meetings tracked by meeting_uuid
- Safe for scheduled imports

**Tests verify**:
- ✓ No duplicate attendees on re-import
- ✓ Same person rejoining creates separate record (different join_time)
- ✓ Unique constraint prevents exact duplicates
- ✓ Multiple import cycles are idempotent

### 3. Members Import (`/api/import/members`) - Append-Only Snapshots

**Pattern**: `INSERT with imported_at timestamp (append-only)`

**Behavior**:
- Each import creates a NEW snapshot with timestamp
- Multiple imports create multiple snapshots (historical record)
- Processing always uses **latest snapshot** (by imported_at)
- **Idempotent at processing level**, not import level
- Enables historical tracking of member data changes

**Tests verify**:
- ✓ Re-import creates new snapshots (not duplicates)
- ✓ Processing uses latest snapshot only
- ✓ Historical snapshots queryable by timestamp
- ✓ Processing is idempotent despite multiple snapshots
- ✓ Multiple import cycles maintain processing idempotency

## Why These Tests Matter

Bronze layer idempotency is critical because:

1. **Scheduled Jobs**: Calendar sync and Zoom import run on cron schedules
2. **Manual Re-runs**: Users can manually re-sync/import without fear
3. **Data Consistency**: No unexpected duplicates or data corruption
4. **Recovery**: Safe to re-import after errors or data issues

## Key Differences from Reprocessability Tests

| Concern | Idempotency Tests | Reprocessability Tests |
|---------|------------------|----------------------|
| **Layer** | Bronze (imports) | Silver (processing) |
| **Pattern** | UPSERT or Append | DELETE + INSERT |
| **Goal** | Safe re-import | Fully regenerable |
| **Files** | `tests/api/idempotency/` | `tests/api/reprocessability/` |

Both are essential architectural properties!

## Running Individual Test Suites

```bash
# Calendar sync only
npm test -- tests/api/idempotency/calendar-sync-idempotency.test.ts

# Zoom import only
npm test -- tests/api/idempotency/zoom-import-idempotency.test.ts

# Members import only
npm test -- tests/api/idempotency/members-import-idempotency.test.ts
```

## Troubleshooting

**Tests fail with database errors:**
- Ensure local Supabase is running OR `.env.local` points to valid remote
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set

**Unique constraint errors:**
- This is expected in some tests - they verify constraints exist
- Check test assertions to see if error is expected

**Timestamp-related failures:**
- Members import tests use setTimeout for distinct timestamps
- If tests run too fast, timestamps might collide (increase sleep duration)

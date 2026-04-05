# Database Architecture: Medallion Pattern

This database follows a **medallion architecture** with three distinct layers: Bronze (raw data), Silver (transformed/inferred data), and Gold (analytics/business metrics).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      BRONZE LAYER                           │
│                    (Raw Data - No Inference)                │
├─────────────────────────────────────────────────────────────┤
│  kajabi_members     │ Raw Kajabi CSV snapshots (temporal)   │
│  zoom_attendees     │ Raw Zoom API participant data         │
│  prickles           │ Writing sessions (Zoom/calendar/Slack)│
│  member_hiatus_     │ Hiatus period tracking                │
│    history          │                                        │
│  member_name_       │ Manual name alias mappings            │
│    aliases          │                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    Data Processing Endpoints
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      SILVER LAYER                           │
│              (Inferred/Transformed Data)                    │
├─────────────────────────────────────────────────────────────┤
│  members            │ Canonical members with status logic   │
│  attendance         │ Member attendance at prickles         │
│  member_metrics     │ Aggregated engagement metrics         │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    Analytics/Aggregation
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       GOLD LAYER                            │
│              (Analytics/Business Metrics)                   │
├─────────────────────────────────────────────────────────────┤
│  member_engagement  │ Risk analysis, engagement tiers       │
│  prickle_popularity │ Session trends, popularity metrics    │
└─────────────────────────────────────────────────────────────┘
```

## Bronze Layer: Raw Data (No Inference)

**Purpose:** Store raw, unprocessed data exactly as received from source systems.

### `kajabi_members`
- **Source:** Kajabi CSV exports
- **Type:** Temporal snapshots (multiple rows per member over time)
- **Schema:**
  - `id` (UUID)
  - `email` (TEXT)
  - `imported_at` (TIMESTAMP)
  - `data` (JSONB) - All Kajabi CSV columns
- **Key Points:**
  - NO business logic applied
  - Preserves complete import history
  - Enables temporal analysis (detect changes over time)
  - One snapshot per import per member

### `zoom_attendees`
- **Source:** Zoom API participant reports
- **Type:** Raw attendance records
- **Schema:** Matches Zoom API response format
- **Key Points:**
  - NO member matching
  - NO prickle association
  - Pure Zoom API data

### `prickles`
- **Source:** Zoom meetings, Google Calendar, Slack schedules
- **Type:** Writing session schedules
- **Key Points:**
  - Can be scheduled (from calendar) or actual (from Zoom)
  - `source` field indicates origin (zoom, calendar, slack, sheets)

### Other Bronze Tables
- `member_hiatus_history` - Manual hiatus period tracking
- `member_name_aliases` - Manual name→member mappings

## Silver Layer: Inferred/Transformed Data

**Purpose:** Clean, enrich, and infer data by applying business logic to Bronze sources.

### `members`
**Derived from:** `kajabi_members` (Bronze)  
**Business Logic Applied:**
- Status inference from Kajabi Products + Tags:
  - `active` = has "Quill & Cup Membership" product
  - `on_hiatus` = has "Quill & Cup Member" tag but NO product
  - `inactive` = has "Offboarding" tag OR neither product nor tag
- Plan extraction from Products column
- Date formatting

**Populated by:** `POST /api/process/members`

### `attendance`
**Derived from:** `zoom_attendees` (Bronze) + `members` (Silver) + `prickles` (Bronze)  
**Business Logic Applied:**
- Member matching via `match_member_by_name()`:
  1. Email match (high confidence)
  2. Alias match (high confidence)
  3. Normalized name match (high confidence)
  4. Fuzzy match (medium/low confidence)
- Prickle association (Zoom meeting → prickle mapping)
- Confidence scoring based on match quality

**Populated by:** `POST /api/process/attendance`

### `member_metrics`
**Derived from:** `attendance` (Silver)  
**Business Logic Applied:**
- Aggregated attendance counts (7-day, 30-day, total)
- Last attended timestamp
- Engagement score calculation

**Populated by:** Future aggregation process

## Gold Layer: Analytics/Business Metrics

**Purpose:** High-level business metrics and analytics for decision-making.

### `member_engagement`
**Derived from:** `member_metrics` (Silver) + `members` (Silver)  
**Business Logic Applied:**
- Risk level assessment (high/medium/low)
- Engagement tier classification (highly_engaged/active/at_risk)
- Churn probability (future ML model)

### `prickle_popularity`
**Derived from:** `attendance` (Silver) + `prickles` (Bronze)  
**Business Logic Applied:**
- Average attendance per prickle
- Attendance trends (increasing/stable/decreasing)
- Historical attendance tracking

## Data Flow: Dependencies & Safe Processing

### Dependency Graph

```
kajabi_members (Bronze)
    ↓ (required)
members (Silver) ──────┐
                       ↓ (required)
zoom_attendees (Bronze)──→ attendance (Silver)
    ↓ (optional)       ↑
prickles (Bronze) ─────┘
```

**Key Dependencies:**
1. `members` requires `kajabi_members` (must import Kajabi first)
2. `attendance` requires `members` + `zoom_attendees` (both must exist)
3. `prickles` can exist independently OR be created during attendance processing

### Safe Processing Order

**✅ Recommended Flow:**
```bash
# 1. Import Kajabi data (Bronze)
POST /api/import/members

# 2. Process members (Silver)
POST /api/process/members

# 3. Import Zoom data (Bronze)
POST /api/import/zoom

# 4. Process attendance (Silver)
POST /api/process/attendance
```

**⚠️ What Happens If You Skip Steps?**

| Scenario | Result | Can Recover? |
|----------|--------|--------------|
| Process members before importing Kajabi | No data to process (returns 0 processed) | ✅ Yes - just import Kajabi then reprocess |
| Process attendance before importing Zoom | No data to process (returns 0 processed) | ✅ Yes - just import Zoom then reprocess |
| Process attendance before processing members | Attendees skipped (can't match to members) | ✅ Yes - process members then reprocess attendance |
| Re-import Kajabi data | Creates new temporal snapshots | ✅ Yes - safe, builds history |
| Re-import Zoom data | Creates duplicate attendees | ⚠️ Maybe - duplicates Bronze but reprocessing Silver is safe |

### Idempotency: What's Safe to Re-run?

#### ✅ SAFE (Idempotent)
These operations use UPSERT or are additive:

**`POST /api/process/members`**
- Uses `UPSERT` with `onConflict: "email"`
- Updates existing members if they exist
- Safe to run multiple times
- **Use case:** Fix bugs in status logic, re-derive from latest kajabi_members

**`POST /api/process/attendance`**
- Uses `UPSERT` with `onConflict: "member_id, prickle_id"`
- Only one attendance record per member per prickle
- Safe to run multiple times
- **Use case:** Fix bugs in matching logic, improve confidence scoring

#### ⚠️ ADDITIVE (Creates New Rows)
These operations INSERT new rows each time:

**`POST /api/import/members`**
- `INSERT` creates new temporal snapshot each time
- Multiple imports = full history
- Safe but intentional (you want history)
- **Use case:** Regular snapshots (daily/weekly) to track changes

**`POST /api/import/zoom`**
- `INSERT` creates new zoom_attendees rows
- Multiple imports = duplicate attendees if same date range
- **Workaround:** Delete from `zoom_attendees` for date range first, OR ignore duplicates in Bronze and rely on Silver deduplication

### Recovery Scenarios

#### Scenario 1: Imported Zoom Before Kajabi
**Problem:** Can't process attendance yet (no members)

**Fix:**
```bash
# 1. Import Kajabi data
POST /api/import/members

# 2. Process members
POST /api/process/members

# 3. Process attendance (Zoom data already in Bronze)
POST /api/process/attendance
```

#### Scenario 2: Found Bug in Status Logic
**Problem:** Members have wrong status values

**Fix:**
```bash
# 1. Fix the status logic in /api/process/members

# 2. Re-process members (UPSERT will update)
POST /api/process/members
```

Silver layer is recalculated from Bronze - no data loss!

#### Scenario 3: Accidentally Imported Zoom Data Twice
**Problem:** Duplicate attendees in zoom_attendees (Bronze)

**Options:**

**A) Ignore duplicates (recommended):**
- Silver layer deduplication handles it
- `attendance` uses `UPSERT` on `(member_id, prickle_id)`
- Only one attendance record per member per prickle

**B) Clean Bronze:**
```sql
-- Delete duplicates (keep earliest)
DELETE FROM zoom_attendees a
USING zoom_attendees b
WHERE a.id > b.id
  AND a.meeting_uuid = b.meeting_uuid
  AND a.email = b.email
  AND a.join_time = b.join_time;
```

#### Scenario 4: Need to Backfill Historical Kajabi Data
**Problem:** Want to import old Kajabi exports

**Fix:**
```bash
# Import old CSV (will get current timestamp)
POST /api/import/members

# Better: Manually set imported_at to historical date
# Insert into kajabi_members with custom imported_at
INSERT INTO kajabi_members (email, imported_at, data)
VALUES (..., '2023-01-01', ...);

# Then process members to update Silver
POST /api/process/members
```

### Data Evolution Over Time

**Week 1:**
```
kajabi_members: 299 rows (1 snapshot)
members: 299 rows
zoom_attendees: 50 rows
attendance: 45 rows (5 unmatched)
```

**Week 2 (after re-import):**
```
kajabi_members: 598 rows (2 snapshots)
  ↳ Can detect who went on hiatus between imports
members: 299 rows (updated via UPSERT)
  ↳ Status reflects latest snapshot
zoom_attendees: 100 rows (new import)
attendance: 90 rows (updated via UPSERT)
  ↳ New prickles added, existing updated
```

**Week 4 (after 4 imports):**
```
kajabi_members: 1196 rows (4 snapshots)
  ↳ Full temporal history
  ↳ Can query status changes over time
members: 299 rows (always current)
zoom_attendees: 200 rows
attendance: 180 rows
```

### Key Principles for Safe Processing

1. **Bronze is Append-Only (Temporal)**
   - Never delete from Bronze unless cleaning up mistakes
   - kajabi_members builds history with each import
   - zoom_attendees can have duplicates (Silver deduplicates)

2. **Silver is Reprocessable**
   - Can always reprocess from Bronze
   - UPSERT ensures idempotency
   - Fix bugs in business logic, re-run processing

3. **Process in Order (Bronze → Silver → Gold)**
   - Import Bronze first
   - Process Silver from Bronze
   - Aggregate Gold from Silver

4. **Dependencies Must Exist**
   - Can't process `attendance` without `members`
   - Can't process `members` without `kajabi_members`
   - Check endpoints return "0 processed" if dependencies missing

5. **Silver Reflects Latest Bronze**
   - `members` always reflects latest `kajabi_members` snapshot
   - `attendance` reflects current `zoom_attendees` + current `members`
   - Reprocessing Silver updates to latest business logic

## Data Flow: Import → Process Workflow

### 1. Import Members (Bronze)
```bash
POST /api/import/members
```
**Input:** Kajabi CSV file  
**Output:** Raw data inserted into `kajabi_members`  
**No business logic applied**

### 2. Process Members (Silver)
```bash
POST /api/process/members
```
**Reads:** `kajabi_members` (latest snapshot)  
**Applies:** Status detection logic  
**Writes:** `members` table

### 3. Import Zoom Data (Bronze)
```bash
POST /api/import/zoom
```
**Input:** Date range (fromDate, toDate)  
**Fetches:** Zoom API participant data  
**Output:** Raw data inserted into `zoom_attendees`  
**No business logic applied**

### 4. Process Attendance (Silver)
```bash
POST /api/process/attendance
```
**Reads:** `zoom_attendees` + `members`  
**Applies:** Member matching, prickle creation/matching  
**Writes:** `attendance` table + `prickles` (from Zoom meetings)

## Key Principles

### ✅ DO
- Keep Bronze layer pure (no inference, no transformation)
- Apply ALL business logic in Silver/Gold layers
- Preserve raw data for reprocessing
- Use temporal snapshots for historical analysis
- Process data through dedicated endpoints

### ❌ DON'T
- Mix inference with raw data import
- Apply business logic during Bronze ingestion
- Modify Bronze data after import
- Skip layers (Bronze → Gold directly)
- Store inferred data in Bronze tables

## Member Status Detection Logic

**Location:** `/api/process/members`

```typescript
if (products.includes("Quill & Cup Membership")) {
  status = "active"; // Has active membership
} else if (tags.includes("Offboarding")) {
  status = "inactive"; // Officially cancelled
} else if (tags.includes("Quill & Cup Member")) {
  status = "on_hiatus"; // Has member tag but no product
} else {
  status = "inactive"; // Leads, trials, former members
}
```

**Temporal Analysis:** Compare `kajabi_members` snapshots over time to detect when members transition between statuses.

## Member Matching Logic

**Location:** `match_member_by_name()` SQL function

**Priority Order:**
1. **Email match** → `high` confidence
2. **Alias match** (from `member_name_aliases`) → `high` confidence
3. **Normalized name match** (case/whitespace/punctuation) → `high` confidence
4. **Fuzzy match** (trigram similarity) → `medium`/`low` confidence

**Used by:** `/api/process/attendance` to link Zoom attendees to members

## Temporal Capabilities

### Kajabi Members History
Query member status changes over time:
```sql
-- Get all snapshots for a member
SELECT imported_at, data->'Products', data->'Tags'
FROM kajabi_members
WHERE email = 'member@example.com'
ORDER BY imported_at;

-- Detect when member went on hiatus
SELECT email, imported_at,
  data->>'Products' as products_before,
  LEAD(data->>'Products') OVER (PARTITION BY email ORDER BY imported_at) as products_after
FROM kajabi_members
WHERE email = 'member@example.com';
```

## Schema Files

- **`schemas/schema.sql`** - Master schema (current state)
- **`migrations/`** - Timestamped schema changes
- **`seed.sql`** - Test data for development

## Testing

Tests verify:
- Member name matching (34 tests)
- Normalization logic
- Fuzzy matching thresholds
- Match confidence scoring

Run tests: `npm test`

## Evolution: From Batch to Streaming/Real-time

### Current Architecture: Batch Processing

**How it works today:**
```
Manual trigger → Import API → Bronze → Manual trigger → Process API → Silver
```

**Characteristics:**
- Periodic imports (daily, weekly)
- Manual processing steps
- Temporal snapshots in Bronze
- Deterministic, testable

### Future Architecture: Streaming/Real-time

**How it could work:**
```
Webhook/Event → Bronze → Database Trigger → Silver (auto-updated)
```

**Migration Path:**

#### Phase 1: Keep Batch, Add Automation (Current → Next)
```sql
-- Add database triggers to auto-process Silver from Bronze
CREATE OR REPLACE FUNCTION auto_process_member()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-update members table when kajabi_members changes
  INSERT INTO members (email, name, joined_at, status, plan)
  VALUES (
    NEW.email,
    NEW.data->>'Name',
    (NEW.data->>'Member Created At')::date,
    derive_status(NEW.data), -- status logic function
    extract_plan(NEW.data)    -- plan extraction function
  )
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    plan = EXCLUDED.plan,
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_kajabi_import
  AFTER INSERT ON kajabi_members
  FOR EACH ROW
  EXECUTE FUNCTION auto_process_member();
```

**Benefits:**
- Still supports batch imports (backward compatible)
- Automatically processes Silver layer
- No manual /api/process/members needed
- Temporal snapshots still preserved in Bronze

#### Phase 2: Add Webhooks (Batch → Hybrid)

**Kajabi Webhooks:**
```
Kajabi → webhook → /api/webhooks/kajabi → kajabi_members → trigger → members
```

**Zoom Webhooks:**
```
Zoom → webhook → /api/webhooks/zoom → zoom_attendees → trigger → attendance
```

**Implementation:**
```typescript
// New endpoint: /api/webhooks/kajabi
export async function POST(request: NextRequest) {
  const payload = await request.json();
  
  // Insert into Bronze (same as batch import)
  await supabase.from("kajabi_members").insert({
    email: payload.email,
    imported_at: new Date().toISOString(),
    data: payload,
  });
  
  // Trigger auto-processes Silver (if Phase 1 triggers exist)
  // OR manually call processing here
}
```

**Characteristics:**
- Real-time updates when Kajabi data changes
- Still preserves temporal snapshots
- Can still do batch imports (CSV) for backfills
- Coexists with batch approach

#### Phase 3: Full Streaming (Hybrid → Real-time)

**Change Data Capture (CDC) with Postgres:**
```
Bronze INSERT → Postgres Logical Replication → Process → Silver UPDATE
```

**Or Supabase Realtime:**
```typescript
// Subscribe to Bronze changes, update Silver
supabase
  .channel('kajabi_changes')
  .on('postgres_changes', 
    { event: 'INSERT', schema: 'public', table: 'kajabi_members' },
    async (payload) => {
      await processMembers(); // Auto-process
    }
  )
  .subscribe();
```

### Why Medallion Architecture Enables This Evolution

**✅ Separation of Concerns:**
- Bronze layer doesn't care if data comes from batch CSV or webhook
- Silver processing logic is the same regardless of trigger
- Business logic centralized in one place

**✅ Temporal Snapshots Preserved:**
- Streaming doesn't break historical analysis
- Each webhook event = new snapshot in Bronze
- Can still query "what was status on 2024-01-15?"

**✅ Reprocessability:**
- If webhook fails, can batch-import CSV
- If processing logic has bugs, can reprocess from Bronze
- Bronze is immutable source of truth

**✅ Testing:**
- Test batch imports in dev
- Same processing logic works for streaming
- Can replay Bronze data to test Silver logic

### Streaming Data Flow Example

**Scenario: Member cancels membership in Kajabi**

#### Current (Batch):
```
1. Next day/week: Admin imports CSV
2. kajabi_members: new snapshot (Offboarding tag added)
3. Admin runs: POST /api/process/members  
4. members: status → inactive
```

#### Future (Streaming):
```
1. Real-time: Kajabi webhook fires
2. kajabi_members: new snapshot (Offboarding tag added)
3. Database trigger auto-fires
4. members: status → inactive (automatically)
5. Optional: Email notification to admin
```

**Bronze stays the same, Silver updates automatically!**

### Backward Compatibility

**All approaches can coexist:**

| Approach | Bronze Write | Silver Update | Use Case |
|----------|-------------|---------------|----------|
| Batch CSV | Manual API call | Manual API call | Backfills, historical data |
| Webhook | Webhook endpoint | Manual API call | Semi-automated |
| Webhook + Trigger | Webhook endpoint | Database trigger | Real-time |
| CDC/Realtime | Webhook endpoint | Event listener | Fully streaming |

**The medallion architecture supports all of these!**

### Migration Checklist: Batch → Streaming

- [ ] Phase 1: Add database triggers for auto-processing
  - [ ] Create `derive_status()` function (extract from API code)
  - [ ] Create `auto_process_member()` trigger
  - [ ] Create `auto_process_attendance()` trigger
  - [ ] Test: batch imports still work, Silver auto-updates
  
- [ ] Phase 2: Add webhook endpoints
  - [ ] Create `/api/webhooks/kajabi`
  - [ ] Create `/api/webhooks/zoom`
  - [ ] Set up webhook signing/verification
  - [ ] Test: webhooks write to Bronze, triggers update Silver
  
- [ ] Phase 3: Enable Supabase Realtime (optional)
  - [ ] Subscribe to Bronze changes
  - [ ] Handle Silver updates in real-time
  - [ ] Add conflict resolution for concurrent updates

**Recommendation:** Start with Phase 1 (triggers). This gives you automatic processing while keeping the simple batch import workflow for development and backfills.

## Future Enhancements

1. **Database Triggers for Auto-processing** - Eliminate manual processing steps
2. **Webhook Endpoints** - Real-time updates from Kajabi/Zoom webhooks
3. **Temporal Hiatus Detection** - Auto-populate `member_hiatus_history` from `kajabi_members` snapshots
4. **Scheduled Prickle Matching** - Match Zoom meetings to scheduled prickles by time overlap
5. **Engagement Score Calculation** - Populate `member_metrics` from `attendance`
6. **Risk Analysis** - Populate `member_engagement` with ML-based predictions

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

## Future Enhancements

1. **Temporal Hiatus Detection** - Auto-populate `member_hiatus_history` from `kajabi_members` snapshots
2. **Scheduled Prickle Matching** - Match Zoom meetings to scheduled prickles by time overlap
3. **Engagement Score Calculation** - Populate `member_metrics` from `attendance`
4. **Risk Analysis** - Populate `member_engagement` with ML-based predictions

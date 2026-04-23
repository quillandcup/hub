# Attendance Data Quality

## Context

**Problem**: Raw Zoom participant data and calendar events contain duplicates, unrecognized names, and need to be matched to member identities before they can be used for attendance tracking.

**Solution**: Process Bronze layer data (calendar_events, zoom_meetings, zoom_participants) into clean Silver layer tables (prickles, attendance) with proper deduplication, name matching, and member attribution.

**Dependencies**:
- Member Identity Management (members table must exist)
- Attendance Data Ingestion (Bronze tables must be populated)

**Scope**: MVP feature for churn reduction initiative.

---

## Data Model

### Local Layer (Configuration)

```sql
-- Prickle types configuration (seeded, not imported)
CREATE TABLE prickle_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  calendar_name_pattern TEXT, -- Regex pattern for calendar event matching
  zoom_topic_pattern TEXT,     -- Regex pattern for Zoom meeting matching
  default_duration_minutes INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_prickle_types_name ON prickle_types(name);

-- Name aliases for member attribution
CREATE TABLE member_name_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  zoom_name TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES members(id)
);

CREATE INDEX idx_member_name_aliases_member ON member_name_aliases(member_id);
CREATE INDEX idx_member_name_aliases_zoom_name ON member_name_aliases(zoom_name);

-- Zoom names to ignore (bots, test accounts, non-members)
CREATE TABLE ignored_zoom_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_name TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES members(id)
);

CREATE INDEX idx_ignored_zoom_names_name ON ignored_zoom_names(zoom_name);
```

### Silver Layer (Processed)

```sql
-- Prickles (writing sessions) from calendar + Zoom
CREATE TABLE prickles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prickle_type_id UUID REFERENCES prickle_types(id),
  prickle_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes INTEGER GENERATED ALWAYS AS 
    (EXTRACT(EPOCH FROM (end_time - start_time)) / 60) STORED,
  
  -- Source tracking
  source TEXT NOT NULL CHECK (source IN ('calendar', 'zoom')),
  calendar_event_id TEXT REFERENCES bronze.calendar_events(google_event_id),
  zoom_meeting_uuid TEXT REFERENCES bronze.zoom_meetings(uuid),
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  UNIQUE(prickle_date, start_time, source, COALESCE(calendar_event_id, ''), COALESCE(zoom_meeting_uuid, ''))
);

CREATE INDEX idx_prickles_date ON prickles(prickle_date);
CREATE INDEX idx_prickles_type ON prickles(prickle_type_id);
CREATE INDEX idx_prickles_source ON prickles(source);

-- Prickle attendance records (member participation in prickles)
CREATE TABLE prickle_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  prickle_id UUID NOT NULL REFERENCES prickles(id) ON DELETE CASCADE,
  
  -- Time tracking (supports multiple join/leave cycles)
  join_time TIMESTAMP WITH TIME ZONE NOT NULL,
  leave_time TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  
  -- Source tracking
  zoom_participant_id TEXT,
  zoom_name TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Allow multiple records per (member_id, prickle_id) for rejoin patterns
  UNIQUE(member_id, prickle_id, join_time)
);

CREATE INDEX idx_prickle_attendance_member ON prickle_attendance(member_id);
CREATE INDEX idx_prickle_attendance_prickle ON prickle_attendance(prickle_id);
CREATE INDEX idx_prickle_attendance_join_time ON prickle_attendance(join_time);
```

---

## Business Rules

### Meeting Segmentation Algorithm

**Requirement**: Split Zoom meetings into individual prickle segments based on calendar schedule.

**Why**: Zoom meetings may run continuously (back-to-back prickles and PUPs), or there may be multiple meetings per day. Each meeting can contain multiple distinct writing sessions (prickles). Must attribute each participant's time to the correct prickle(s).

**Algorithm Details**: See `/docs/ATTENDANCE_RULES.md` for the authoritative specification including:
- The 7-rule segmentation algorithm (20-minute threshold)
- 15-minute edge filter for PUP attendance
- Detailed examples with specific times and scenarios
- Rationale for each threshold value

**High-Level Principles**:
1. Calculate meeting time window from **matched attendees only** (prevents 0-attendee PUP segments for bot/unmatched activity)
2. Use **20-minute threshold** to decide whether to create a separate PUP (>20 min gap = distinct gathering; <20 min gap = part of adjacent prickle)
3. Apply **15-minute edge filter** to avoid double-counting participants who join slightly early/late for adjacent scheduled prickles
4. Preserve **multiple join/leave cycles** per prickle (bathroom breaks, phone calls, etc.)

### Member Attribution

**Requirement**: Match Zoom participant names to member accounts.

**Matching Strategy** (in priority order):
1. **Manual aliases**: Admin-created zoom_name → member_id mappings (highest confidence)
2. **Email match**: Zoom email matches member email (high confidence)
3. **Name normalization**: Fuzzy match on normalized names (medium confidence)

**Ignored Names**: Filter out bots, test accounts, and non-members via `ignored_zoom_names` table.

**Unmatched Handling**: Log unmatched names for admin review, skip creating attendance records.

### Processing Workflow

**High-Level Steps**:

1. **Delete existing Silver data** for date range (DELETE + INSERT pattern for reprocessability)
   - Delete prickle_attendance records that overlap date range
   - Delete PUP prickles (source='zoom') that overlap date range

2. **Load reference data** (in-memory for performance)
   - Calendar prickles that overlap date range
   - All members and name aliases
   - Prickle type IDs (especially Pop-Up Prickle)

3. **Group Zoom participants** by meeting_uuid

4. **For each meeting**:
   - Calculate meeting window from MATCHED participants only (earliest join, latest leave)
   - Find overlapping calendar prickles
   - Split meeting into segments using 7-rule algorithm
   - Create new PUP prickles for non-calendar segments

5. **For each participant**:
   - Match to member (or skip if unmatched/ignored)
   - Calculate time intersection with each segment
   - Apply 15-minute edge filter
   - Collect attendance records

6. **Batch insert** attendance records (500-record chunks, parallel)

---

## API Contracts

### POST /api/process/attendance

**Purpose**: Reprocess Zoom participant data into prickles and attendance for a date range.

**Request**:
```json
{
  "fromDate": "2024-01-01",
  "toDate": "2024-01-31"
}
```

**Response**:
```json
{
  "success": true,
  "zoomAttendees": 150,
  "matchedAttendees": 142,
  "skippedUnmatched": 8,
  "meetingsProcessed": 31,
  "segmentsCreated": 95,
  "matchedToCalendar": 83,
  "createdNewPrickles": 12,
  "attendanceRecords": 384,
  "matchRate": 95
}
```

**Behavior**:
- DELETE + INSERT pattern (reprocessable)
- Processes all meetings that overlap date range
- Creates PUP prickles as needed
- Skips unmatched participants (logs names for admin review)
- Idempotent: re-running produces identical results

**Performance**: 
- Timeout: 300s max duration
- Batch size: 500 records per insert
- In-memory matching for speed

---

## Webhook Integration

### Calendar Webhook

**Endpoint**: `POST /api/webhooks/calendar`

**Trigger**: Google Calendar sends notification when events change

**Behavior**:
- Verify webhook signature
- Sync last 7 days of calendar events
- Trigger prickle reprocessing for those 7 days
- Return 200 OK immediately

**Security**: Validate `x-goog-channel-token` matches `GOOGLE_WEBHOOK_SECRET`

### Zoom Webhook

**Endpoint**: `POST /api/webhooks/zoom`

**Events Handled**:
- `meeting.participant_joined`: Update Bronze layer participant record with join time
- `meeting.participant_left`: Update participant record with leave time, trigger processing
- `meeting.ended`: Trigger full processing for that meeting's date

**Behavior**:
- Verify webhook signature (HMAC-SHA256)
- Update Bronze layer data
- Trigger Silver layer processing for affected date
- Return 200 OK immediately

**Security**: Validate `x-zm-signature` using `ZOOM_WEBHOOK_SECRET_TOKEN`

---

## Admin UI Requirements

### Name Alias Management Page

**Location**: `/admin/data/aliases`

**Features**:
1. **Unmatched Names Section**
   - Display: zoom_name, occurrence_count, last_seen
   - Actions: Map to member (dropdown), Mark as ignored
   - Sort: by occurrence count (descending)

2. **Existing Aliases Section**
   - Display: zoom_name, member_name, source (auto/manual), created_at
   - Actions: Delete alias
   - Filter: by source, by member

3. **Bulk Import**
   - Upload CSV: zoom_name, member_email
   - Validate emails match members
   - Create aliases with source='manual'

### Ignored Names Management Page

**Location**: `/admin/data/ignored-names`

**Features**:
1. List all ignored names with reason
2. Add new ignored name (with reason)
3. Remove from ignore list

---

## Testing Requirements

### Reprocessability Tests

**Verify DELETE + INSERT pattern**:
1. Initial processing creates attendance records
2. Deleting Bronze data + reprocessing removes Silver records (orphan detection)
3. Changing Bronze data + reprocessing updates Silver correctly
4. Multiple reprocessing cycles produce identical results

### Segmentation Algorithm Tests

**7-rule splitting**:
1. No scheduled prickles → single PUP
2. Early arrival (<20 min) → included in first prickle
3. Early arrival (>20 min) → PUP before + first prickle
4. Late stay (<20 min) → included in last prickle
5. Late stay (>20 min) → last prickle + PUP after
6. Gap between prickles → PUP in middle
7. Multiple prickles → correct boundaries

### Edge Filter Tests

**15-minute filtering**:
1. Short segment (<15 min) adjacent to longer → filtered out
2. Short segment (<15 min) standalone → kept
3. Long segment (≥15 min) → always kept
4. Multiple short segments in sequence → all kept (no adjacent long segments)

### Member Matching Tests

**Attribution logic**:
1. Manual alias match → highest confidence
2. Email match → high confidence  
3. Name normalization match → medium confidence
4. Ignored name → skipped
5. Unmatched → logged, skipped

### Performance Tests

**Scale verification**:
1. 10,000+ participants in single month → completes in <300s
2. Pagination works correctly for large result sets
3. Batch inserts handle 500-record chunks
4. In-memory matching performs efficiently

---

## Success Criteria

1. **Data Quality**:
   - [ ] No duplicate prickles for same time/source
   - [ ] No duplicate attendance for same (member, prickle, join_time)
   - [ ] PUPs only created for matched participant activity
   - [ ] Multiple join/leave cycles preserved correctly

2. **Matching Accuracy**:
   - [ ] >95% of Zoom participants matched to members
   - [ ] Manual aliases take precedence over auto-matching
   - [ ] Ignored names filtered out (0 attendance records)

3. **Performance**:
   - [ ] Processing 1 month completes in <60s
   - [ ] Processing 1 year completes in <300s
   - [ ] No timeout failures on production data volumes

4. **Reprocessability**:
   - [ ] Reprocessing produces identical results
   - [ ] Deleted Bronze data removes Silver orphans
   - [ ] Changed Bronze data updates Silver correctly

---

## Implementation Phases

### Phase 1: Core Processing (Week 1)
- [ ] Create Local tables (prickle_types, member_name_aliases, ignored_zoom_names)
- [ ] Create Silver tables (prickles, prickle_attendance)
- [ ] Implement segmentation algorithm (7 rules)
- [ ] Implement member matching logic
- [ ] Implement 15-minute edge filter

### Phase 2: API Routes (Week 1)
- [ ] POST /api/process/attendance
- [ ] Error handling and logging
- [ ] Performance optimization (batch inserts, in-memory matching)

### Phase 3: Webhook Integration (Week 2)
- [ ] Calendar webhook handler
- [ ] Zoom webhook handler
- [ ] Signature verification
- [ ] Incremental processing triggers

### Phase 4: Admin UI (Week 2)
- [ ] Alias management page
- [ ] Ignored names management
- [ ] Unmatched names review
- [ ] Bulk import functionality

### Phase 5: Testing (Week 3)
- [ ] Reprocessability tests
- [ ] Segmentation algorithm tests
- [ ] Edge filter tests
- [ ] Member matching tests
- [ ] Performance tests

---

## Future Enhancements

1. **Auto-aliasing Improvements**:
   - Fuzzy name matching (Levenshtein distance)
   - Learn from admin corrections
   - Suggest aliases based on email domain

2. **Anomaly Detection**:
   - Alert on duplicate attendance (same member, overlapping times)
   - Flag suspiciously short sessions (<5 min)
   - Detect name changes (same participant_id, different names)

3. **Performance Optimizations**:
   - Materialized views for common queries
   - Incremental processing (only changed participants)
   - Parallel processing for multiple meetings

4. **Historical Data Migration**:
   - Bulk import past Zoom recordings
   - Parse legacy attendance spreadsheets
   - Backfill attendance from manual records

---

---

## References

- **Algorithm Specification** (permanent docs): `/docs/ATTENDANCE_RULES.md` - authoritative source for segmentation rules, thresholds, detailed examples, and rationale
- **Current Implementation**: `/app/api/process/attendance/route.ts` (working code as of 2026-04-22)

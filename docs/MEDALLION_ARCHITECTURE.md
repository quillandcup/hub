# Medallion Architecture - Quill & Cup Admin Portal

## Overview

This system uses a **Medallion Architecture** with Bronze (raw imports), Local (operational), Silver (canonical), and Gold (aggregated) layers.

## Data Flow Diagram

```mermaid
graph TB
    subgraph "External Sources"
        Kajabi[Kajabi API<br/>Members & Subscriptions]
        Zoom[Zoom API<br/>Meetings & Attendees]
        Calendar[Google Calendar<br/>Scheduled Events]
        Slack[Slack API<br/>Messages & Reactions]
    end

    subgraph "Bronze Layer - Raw Imports (UPSERT)"
        BronzeKajabi[(kajabi_members<br/>subscription_history)]
        BronzeZoom[(zoom_meetings<br/>zoom_attendees)]
        BronzeCalendar[(calendar_events)]
        BronzeSlack[(slack_users<br/>slack_channels<br/>slack_messages<br/>slack_reactions)]
    end

    subgraph "Local Layer - Operational Data (CRUD)"
        LocalAliases[(member_name_aliases)]
        LocalHiatus[(member_hiatus_history)]
        LocalIgnored[(ignored_zoom_names<br/>ignored_slack_users)]
        LocalTypes[(prickle_types)]
        LocalStaff[(staff)]
    end

    subgraph "Silver Layer - Canonical State"
        SilverMembers[(members<br/>UPSERT by email)]
        SilverPrickles[(prickles<br/>DELETE + INSERT)]
        SilverAttendance[(prickle_attendance<br/>DELETE + INSERT)]
        SilverActivities[(member_activities<br/>DELETE + INSERT)]
    end

    subgraph "Gold Layer - Aggregated Views"
        GoldMetrics[(member_metrics)]
        GoldEngagement[(member_engagement)]
        GoldPopularity[(prickle_popularity)]
    end

    subgraph "Processing Routes"
        ProcessMembers[/api/process/members<br/>Identity Entity Pattern/]
        ProcessCalendar[/api/process/calendar<br/>Event Entity Pattern/]
        ProcessAttendance[/api/process/attendance<br/>Event Entity Pattern/]
        ProcessSlack[/api/process/slack<br/>Event Entity Pattern/]
    end

    %% Import flows (Bronze ← External)
    Kajabi -->|/api/import/members<br/>UPSERT by kajabi_id| BronzeKajabi
    Kajabi -->|/api/import/subscriptions<br/>UPSERT by stripe_id| BronzeKajabi
    Zoom -->|/api/import/zoom<br/>UPSERT by meeting_uuid| BronzeZoom
    Calendar -->|/api/sync/calendar<br/>UPSERT by google_event_id| BronzeCalendar
    Slack -->|/api/import/slack<br/>UPSERT by message_ts| BronzeSlack

    %% Processing flows (Silver ← Bronze + Local)
    BronzeKajabi -->|Read| ProcessMembers
    ProcessMembers -->|UPSERT by email<br/>Preserves UUIDs| SilverMembers
    
    BronzeCalendar -->|Read| ProcessCalendar
    LocalTypes -->|Read| ProcessCalendar
    LocalAliases -->|Read for host matching| ProcessCalendar
    ProcessCalendar -->|DELETE by date range<br/>INSERT fresh| SilverPrickles
    
    BronzeZoom -->|Read| ProcessAttendance
    LocalAliases -->|Read for name matching| ProcessAttendance
    LocalIgnored -->|Read to skip| ProcessAttendance
    ProcessAttendance -->|DELETE by date range<br/>INSERT fresh| SilverPrickles
    ProcessAttendance -->|DELETE by date range<br/>INSERT fresh| SilverAttendance
    
    BronzeSlack -->|Read| ProcessSlack
    LocalAliases -->|Read for user matching| ProcessSlack
    LocalIgnored -->|Read to skip| ProcessSlack
    ProcessSlack -->|DELETE + INSERT| SilverActivities

    %% Auto-triggers
    ProcessMembers -.->|Auto-triggers| ProcessCalendar
    ProcessMembers -.->|Auto-triggers| ProcessAttendance
    ProcessCalendar -.->|Auto-triggers| ProcessAttendance

    %% Gold aggregations
    SilverMembers -->|Aggregate| GoldMetrics
    SilverAttendance -->|Aggregate| GoldMetrics
    SilverActivities -->|Aggregate| GoldMetrics
    SilverAttendance -->|Aggregate| GoldEngagement
    SilverPrickles -->|Aggregate| GoldPopularity

    style BronzeKajabi fill:#cd7f32
    style BronzeZoom fill:#cd7f32
    style BronzeCalendar fill:#cd7f32
    style BronzeSlack fill:#cd7f32
    
    style LocalAliases fill:#90EE90
    style LocalHiatus fill:#90EE90
    style LocalIgnored fill:#90EE90
    style LocalTypes fill:#90EE90
    style LocalStaff fill:#90EE90
    
    style SilverMembers fill:#C0C0C0
    style SilverPrickles fill:#C0C0C0
    style SilverAttendance fill:#C0C0C0
    style SilverActivities fill:#C0C0C0
    
    style GoldMetrics fill:#FFD700
    style GoldEngagement fill:#FFD700
    style GoldPopularity fill:#FFD700
```

## Layer Responsibilities

### Bronze Layer (Raw Imports)
**Pattern:** UPSERT on natural keys for idempotency
**Purpose:** Permanent archive of all imported data
**Retention:** Forever (append-only or update-only)

- `kajabi_members` - Latest member snapshot from Kajabi
- `subscription_history` - Subscription state changes
- `zoom_meetings` - Meeting metadata
- `zoom_attendees` - Individual join/leave events
- `calendar_events` - Scheduled prickle events
- `slack_users`, `slack_channels`, `slack_messages`, `slack_reactions` - Slack data

**Key Points:**
- Data is NEVER deleted (only updated via UPSERT)
- Enables debugging and historical analysis
- Makes processing fully reprocessable

### Local Layer (Operational Data)
**Pattern:** Normal CRUD operations
**Purpose:** Data owned by this application
**Retention:** User-managed

- `member_name_aliases` - Manual name mappings for matching
- `member_hiatus_history` - Hiatus periods
- `ignored_zoom_names` - Names to skip during processing
- `ignored_slack_users` - Slack users to skip
- `prickle_types` - Event type definitions
- `staff` - Staff member records

**Key Points:**
- This is the source of truth for these tables
- NOT reprocessed (would lose user edits)
- Combined with Bronze during Silver processing

### Silver Layer (Canonical State)
**Two patterns based on entity type:**

#### Identity Entities (UPSERT Pattern)
**Example:** `members`
**Why:** Must preserve UUIDs to maintain foreign key relationships

```sql
-- Pattern: UPSERT by stable identifier (email)
INSERT INTO members (email, name, ...)
SELECT ...
FROM bronze.kajabi_members
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = NOW();
```

**Benefits:**
- Member UUIDs never change
- Aliases, hiatus history, attendance records remain linked
- No orphaned relationships

#### Event Entities (DELETE + INSERT Pattern)
**Examples:** `prickles`, `prickle_attendance`, `member_activities`
**Why:** Must remove events that no longer exist in source data

```sql
-- Pattern: DELETE by scope, then INSERT fresh
DELETE FROM prickles
WHERE start_time >= $fromDate
  AND start_time < $toDate
  AND source = 'calendar';

INSERT INTO prickles (...)
SELECT ...
FROM bronze.calendar_events ce
JOIN local.prickle_types pt ON ...
LEFT JOIN local.member_name_aliases ma ON ...;
```

**Benefits:**
- Deleted calendar events disappear from prickles
- Members who left Zoom meetings are removed
- Always reflects current truth from Bronze + Local

### Gold Layer (Aggregated Views)
**Pattern:** Computed on-demand or via materialized views
**Purpose:** Performance optimization for dashboards

- `member_metrics` - Per-member statistics
- `member_engagement` - Engagement scores and risk levels
- `prickle_popularity` - Attendance patterns by type/time

## Processing Dependencies

```mermaid
graph LR
    Members[Process Members]
    Calendar[Process Calendar]
    Attendance[Process Attendance]
    Slack[Process Slack]
    
    Members -->|Required| Calendar
    Members -->|Required| Attendance
    Calendar -->|Required| Attendance
    
    Members -.->|Auto-trigger| Calendar
    Members -.->|Auto-trigger| Attendance
    Calendar -.->|Auto-trigger| Attendance
    
    style Members fill:#90EE90
    style Calendar fill:#87CEEB
    style Attendance fill:#FFD700
    style Slack fill:#DDA0DD
```

**Dependency Rules:**
1. Members must be processed before Calendar (for host matching)
2. Members must be processed before Attendance (for attendee matching)
3. Calendar must be processed before Attendance (for scheduled prickle UUIDs)
4. Changes to aliases auto-trigger Calendar and Attendance reprocessing

## Reprocessability Guarantees

### Full Reprocessability
**Command:** Re-run all processing routes with same Bronze + Local data
**Result:** Identical Silver state (excluding UUIDs and timestamps)

**Example:**
```bash
# Original processing
POST /api/process/members
POST /api/process/calendar?fromDate=2026-01-01&toDate=2026-12-31
POST /api/process/attendance?fromDate=2026-01-01&toDate=2026-12-31

# Reprocessing (yields same result)
POST /api/process/members
POST /api/process/calendar?fromDate=2026-01-01&toDate=2026-12-31
POST /api/process/attendance?fromDate=2026-01-01&toDate=2026-12-31
```

### Why It Works
1. **Bronze never deleted** - Always have source data
2. **Local preserved** - User edits not lost
3. **Silver uses atomic functions** - DELETE + INSERT in single transaction
4. **Identity entities use stable keys** - Member email = permanent identifier

### What Changes on Reprocessing
- Event entities: New UUIDs (but foreign keys work via stable identifiers)
- Timestamps: `created_at`, `updated_at` reflect reprocessing time
- Computed fields: Recalculated from current Bronze + Local

### What's Preserved
- Identity entity UUIDs: Member UUIDs stay same
- Relationships: All foreign keys remain valid
- User data: Aliases, hiatus history, ignored names
- Historical accuracy: Same prickles, same attendance

## Testing Reprocessability

Every processing route must pass:
1. **Initial processing** - Creates records
2. **Reprocessing unchanged** - Same result
3. **Reprocessing with deleted source** - Removes Silver records
4. **Reprocessing with changed source** - Updates Silver records

See: `tests/api/reprocessability/`

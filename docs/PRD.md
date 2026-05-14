# PRD — Quill & Cup Attendance & Engagement Analytics (v1)

## 1. Overview

Quill & Cup runs 50+ weekly Zoom writing sessions ("Prickles") using a single shared Zoom link. Attendance is currently not tracked, making it difficult to:

- Identify members at risk of churn
- Understand which sessions are most valuable
- Measure engagement and retention
- Improve programming decisions

This system will ingest raw data, infer attendance, and surface actionable insights.

This is an internal admin tool, not member-facing.

## 2. Goals

### Primary Goals
- Identify at-risk members
- Measure engagement trends
- Understand session popularity
- Reduce churn via better visibility

### Secondary Goals
- Build reusable analytics infrastructure
- Enable future nudging/automation ("Accountabillie Bot")
- Enable long-term cohort analysis

## 3. Non-Goals (v1)
- Perfect attendance accuracy
- Member-facing dashboards
- Automated nudging
- Billing or subscription management
- Real-time ingestion

## 4. Users

### Primary User

Quill & Cup (Ania / Cody)

**Needs:**
- See who isn't showing up
- See which sessions work
- Understand engagement patterns
- Make programming decisions

## 5. Data Sources

### 5.1 Kajabi (Membership Source of Truth)

**Used for:**
- Active members
- Email
- Join date
- Membership status

**Sync frequency:** Daily (initially manual / cron later)

### 5.2 Zoom Attendance (Raw)

**Fields:**
- name
- email
- join_time
- leave_time
- duration
- meeting_id (single shared link)

**Challenges:**
- Same meeting link
- Names inconsistent
- Emails sometimes missing

Inference required.

### 5.3 Session Schedule

**Sources:**
- Google Calendar (preferred)
- Slack announcements (fallback)
- Google Sheets (legacy)

**Fields:**
- session_title
- host
- start_time
- end_time
- type

## 6. System Architecture

### 6.1 Medallion Architecture

This system uses a **medallion architecture** (bronze/silver/gold) to organize data transformation:

- **Bronze Layer (Raw Data)**: Unprocessed data from source systems (Kajabi, Zoom, Calendar)
- **Silver Layer (Transformed Data)**: Cleaned, validated, and inferred data
- **Gold Layer (Analytics)**: Aggregated business metrics and insights

This architecture enables:
- Clear separation of concerns
- Incremental data quality improvements
- Easy reprocessing and debugging
- Audit trail of transformations

### 6.2 Database Schema

#### Bronze Layer (Raw Data)

**`members`** - Raw member data from Kajabi

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | Member name |
| email | text | Member email |
| joined_at | timestamp | Join date |
| status | text | active/inactive |
| plan | text | Membership plan |
| raw_payload | jsonb | Full API response |

**`zoom_attendees`** - Raw Zoom attendance records

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | Display name |
| email | text | Email (may be null) |
| join_time | timestamp | Join timestamp |
| leave_time | timestamp | Leave timestamp |
| duration | integer | Duration in minutes |
| raw_payload | jsonb | Full API response |

**`sessions`** - Scheduled sessions from calendar/Slack

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| title | text | Session title |
| host | text | Host name |
| start_time | timestamp | Start time |
| end_time | timestamp | End time |
| type | text | Session type |
| source | text | calendar/slack/sheets |

#### Silver Layer (Inferred Data)

**`attendance`** - Attendance inferred by time overlap

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| member_id | uuid | FK to members |
| session_id | uuid | FK to sessions |
| join_time | timestamp | Inferred join time |
| leave_time | timestamp | Inferred leave time |
| confidence_score | text | high/medium/low |

**`member_metrics`** - Enriched member metrics

| Field | Type | Description |
|-------|------|-------------|
| member_id | uuid | FK to members |
| last_attended_at | timestamp | Last session date |
| sessions_last_7_days | integer | Count |
| sessions_last_30_days | integer | Count |
| total_sessions | integer | All-time count |
| engagement_score | integer | Calculated score |

#### Gold Layer (Analytics)

**`member_engagement`** - Member risk and engagement analysis

| Field | Type | Description |
|-------|------|-------------|
| member_id | uuid | FK to members |
| risk_level | text | high/medium/low |
| engagement_tier | text | highly_engaged/active/at_risk |
| churn_probability | float | Future: ML prediction |

**`session_popularity`** - Session attendance trends

| Field | Type | Description |
|-------|------|-------------|
| session_id | uuid | FK to sessions |
| avg_attendance | float | Average attendance |
| last_5_attendance | integer[] | Recent attendance counts |
| trend | text | increasing/stable/decreasing |

## 7. Inference Logic

Attendance inferred by:

### Step 1
Find sessions overlapping Zoom join time:
```
join_time <= session_end
leave_time >= session_start
```

### Step 2
Match attendee email to member email

**Fallback:**
- fuzzy name match
- manual mapping (future)

### Step 3
Confidence scoring

- **High**: email match + strong time overlap
- **Medium**: name match + overlap
- **Low**: weak overlap

## 8. Engagement Scoring

Simple heuristic:

**Score components:**
- Sessions last 7 days
- Sessions last 30 days
- Recency

**Example:**
```
score = 
  (sessions_7d * 5) + 
  (sessions_30d * 2) + 
  recency_bonus
```

## 9. Risk Classification

| Risk Level | Criteria |
|------------|----------|
| **High Risk** | No attendance in 30 days |
| **Medium Risk** | 1 attendance in 30 days |
| **Low Risk** | 2+ attendance in 30 days |
| **Highly Engaged** | 5+ attendance in 30 days |

## 10. UI Requirements

### 10.1 Dashboard

**Top Metrics**
- Active Members
- Attended last 7 days
- Attended last 30 days
- At-risk members

**Charts**
- Attendance over time
- Active members over time

### 10.2 Member Table

**Columns**
- Name
- Email
- Last attended
- Sessions last 30 days
- Total sessions
- Engagement score
- Risk level

**Filters**
- Active only
- At risk
- Highly engaged

### 10.3 Session Popularity

**Columns**
- Session
- Host
- Avg attendance
- Last 5 attendance
- Trend

### 10.4 Attendance Timeline

**Charts**
- Sessions per week
- Attendance per week
- Unique members per week

## 11. MVP Scope

### Included:
- Manual ingestion (CSV or API)
- Inference logic
- Dashboard UI
- Basic scoring

### Excluded:
- Overrides
- Real-time updates
- Automation

## 12. Tech Stack

**Frontend**
- Next.js
- Tailwind
- Server Components

**Backend**
- Supabase
- Postgres
- pgmq (event queue)

**Hosting**
- Vercel

## 13. Data Pipeline

**Pipeline:**
1. Import raw data
2. Insert event into queue
3. Worker processes inference
4. Worker writes silver tables
5. Worker computes gold tables

Reprocessing supported.

## 14. Future Features

### Accountabillie Bot
- Slack nudges
- Email nudges
- Personalized prompts

### Predictive Churn
- ML model
- Cohort analysis

### Member-facing Dashboard
- Personal engagement metrics
- Session recommendations

### Background Agents
- Parallel development tasks
- Automated testing agents
- Schema validation agents
- Code quality checks

## 15. Success Metrics

**Within 30 days:**
- Identify 5+ at-risk members
- Improve attendance visibility
- Make programming decision based on data

**Within 90 days:**
- Reduce churn
- Increase average attendance

## 16. Milestones

**Phase 1**
- Data ingestion
- Schema

**Phase 2**
- Inference logic

**Phase 3**
- Dashboard UI

**Phase 4**
- Engagement scoring

## 17. First MVP Deliverable

Admin dashboard that answers:
- Who hasn't attended recently?
- Which sessions are popular?
- Who is highly engaged?

That's the first version.

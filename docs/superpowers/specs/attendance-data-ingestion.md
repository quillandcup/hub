# Attendance Data Ingestion

**Date:** 2026-04-22  
**Status:** Draft - Ready for Implementation  
**Dependencies:** [Architecture Foundation](./architecture-foundation.md)  
**Blocks:** [Attendance Data Quality](./attendance-data-quality.md), [Admin Churn Dashboard](./admin-churn-dashboard.md)

---

## Overview

### Problem Statement

To track member engagement and identify churn risk, we need accurate data about:
- **Calendar events** - Scheduled prickles (writing sessions) from Google Calendar
- **Zoom meetings** - Actual sessions that occurred
- **Zoom participants** - Who participated in which sessions, for how long

**Current challenges:**
- Data scattered across Google Calendar and Zoom
- Manual CSV exports are time-consuming and stale
- Need automated reconciliation for fresh data
- Must handle pagination (1000+ events, 10,000+ attendance records)

### Solution

**Automated data ingestion pipeline:**
- **Zoom Webhooks** - Real-time participant join/leave events to `bronze.zoom_participants`
- **Google Calendar Webhooks** - Real-time calendar changes to `bronze.calendar_events`
- **Daily reconciliation** - Full sync every night (safety net for missed webhooks)
- **CSV import** - Local testing and initial bootstrapping only

**Pattern:** Webhooks + reconciliation (consistent across all data sources)

---

## Data Model

### Bronze Layer: Calendar Events

**Schema:** `bronze` (hidden from Supabase API)

```sql
CREATE TABLE bronze.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_event_id TEXT UNIQUE NOT NULL,
  calendar_id TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  event_type TEXT,
  recurrence_rule TEXT,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_calendar_events_start ON bronze.calendar_events(start_time);
CREATE INDEX idx_calendar_events_calendar ON bronze.calendar_events(calendar_id);
CREATE INDEX idx_calendar_events_date_range ON bronze.calendar_events(start_time, end_time);

COMMENT ON TABLE bronze.calendar_events IS 'BRONZE: UPSERT by google_event_id';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_bronze_calendar_events_updated_at 
  BEFORE UPDATE ON bronze.calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Bronze Layer: Zoom Meetings

```sql
CREATE TABLE bronze.zoom_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_uuid TEXT UNIQUE NOT NULL,
  meeting_id TEXT NOT NULL,
  topic TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  participants_count INTEGER,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_zoom_meetings_start ON bronze.zoom_meetings(start_time);
CREATE INDEX idx_zoom_meetings_id ON bronze.zoom_meetings(meeting_id);
CREATE INDEX idx_zoom_meetings_date_range ON bronze.zoom_meetings(start_time, end_time);

COMMENT ON TABLE bronze.zoom_meetings IS 'BRONZE: UPSERT by meeting_uuid';
COMMENT ON COLUMN bronze.zoom_meetings.meeting_uuid IS 'Unique identifier for this specific meeting instance';
COMMENT ON COLUMN bronze.zoom_meetings.meeting_id IS 'Recurring meeting ID (same across instances)';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_bronze_zoom_meetings_updated_at 
  BEFORE UPDATE ON bronze.zoom_meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Bronze Layer: Zoom Participants

```sql
CREATE TABLE bronze.zoom_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_uuid TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  join_time TIMESTAMP WITH TIME ZONE NOT NULL,
  leave_time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(meeting_uuid, participant_id, join_time)
);

CREATE INDEX idx_zoom_participants_meeting ON bronze.zoom_participants(meeting_uuid);
CREATE INDEX idx_zoom_participants_email ON bronze.zoom_participants(email);
CREATE INDEX idx_zoom_participants_name ON bronze.zoom_participants(name);
CREATE INDEX idx_zoom_participants_join ON bronze.zoom_participants(join_time);

COMMENT ON TABLE bronze.zoom_participants IS 'BRONZE: UPSERT by (meeting_uuid, participant_id, join_time)';
COMMENT ON COLUMN bronze.zoom_participants.participant_id IS 'Zoom participant identifier (changes across sessions)';
COMMENT ON COLUMN bronze.zoom_participants.join_time IS 'Multiple records allowed if someone leaves and rejoins';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_bronze_zoom_participants_updated_at 
  BEFORE UPDATE ON bronze.zoom_participants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Import Pattern:**
- All tables use UPSERT by natural key
- Re-importing same data updates `updated_at`, no duplicates
- Idempotent by definition

---

## Google Calendar Reconciliation

### API Setup

**Required scopes:**
- `https://www.googleapis.com/auth/calendar.readonly`

**OAuth 2.0 flow:**
- Service account with domain-wide delegation (for automated access)
- Or OAuth flow for initial setup (store refresh token)

### Reconciliation Logic

**File:** `app/api/cron/reconcile-calendar/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { google } from "googleapis";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const supabase = await createClient();
  const calendar = createCalendarClient();
  
  // Sync last 3 months and next 1 month
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 3);
  const toDate = new Date();
  toDate.setMonth(toDate.getMonth() + 1);
  
  const events = await fetchAllCalendarEvents(calendar, fromDate, toDate);
  
  // UPSERT to bronze layer
  for (const event of events) {
    await supabase.from("bronze.calendar_events").upsert({
      google_event_id: event.id,
      calendar_id: event.organizer?.email || 'primary',
      summary: event.summary,
      description: event.description,
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      event_type: event.eventType,
      recurrence_rule: event.recurrence?.join(','),
      data: event
    }, { onConflict: 'google_event_id' });
  }
  
  // Trigger downstream processing
  await fetch('/api/process/prickles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString()
    })
  });
  
  return NextResponse.json({
    success: true,
    imported: events.length,
    dateRange: { from: fromDate, to: toDate }
  });
}

function createCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!),
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
  });
  
  return google.calendar({ version: 'v3', auth });
}

async function fetchAllCalendarEvents(
  calendar: any,
  fromDate: Date,
  toDate: Date
): Promise<any[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  let allEvents: any[] = [];
  let pageToken: string | undefined;
  
  do {
    const response = await calendar.events.list({
      calendarId: calendarId,
      timeMin: fromDate.toISOString(),
      timeMax: toDate.toISOString(),
      maxResults: 250,
      pageToken: pageToken,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    allEvents = allEvents.concat(response.data.items || []);
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  
  return allEvents;
}
```

### Google Calendar Webhook Handler

Google Calendar supports push notifications via webhooks for real-time event updates.

**File:** `app/api/webhooks/google-calendar/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { google } from "googleapis";

export async function POST(request: NextRequest) {
  // Verify webhook signature
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');
  
  if (!channelId || resourceState !== 'exists') {
    return NextResponse.json({ received: true });
  }
  
  // Calendar changed - fetch latest events
  const calendar = createCalendarClient();
  const supabase = await createClient();
  
  // Sync recent events (last week to next month)
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  const toDate = new Date();
  toDate.setMonth(toDate.getMonth() + 1);
  
  const events = await fetchAllCalendarEvents(calendar, fromDate, toDate);
  
  for (const event of events) {
    await supabase.from("bronze.calendar_events").upsert({
      google_event_id: event.id,
      calendar_id: event.organizer?.email || 'primary',
      summary: event.summary,
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      data: event
    }, { onConflict: 'google_event_id' });
  }
  
  // Trigger processing for affected date range
  await fetch('/api/process/prickles', {
    method: 'POST',
    body: JSON.stringify({
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString()
    })
  });
  
  return NextResponse.json({ received: true });
}
```

---

## Zoom Reconciliation

### API Setup

**Required:**
- Zoom Server-to-Server OAuth app
- Account ID, Client ID, Client Secret

**Scopes:**
- `meeting:read:admin`
- `report:read:admin`

### Reconciliation Logic

**File:** `app/api/cron/reconcile-zoom/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const supabase = await createClient();
  
  // Sync last 3 months of meetings
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 3);
  const toDate = new Date();
  
  const { meetings, participants } = await fetchZoomData(fromDate, toDate);
  
  // UPSERT meetings
  for (const meeting of meetings) {
    await supabase.from("bronze.zoom_meetings").upsert({
      meeting_uuid: meeting.uuid,
      meeting_id: meeting.id.toString(),
      topic: meeting.topic,
      start_time: meeting.start_time,
      end_time: meeting.end_time,
      duration_minutes: meeting.duration,
      participants_count: meeting.participants_count,
      data: meeting
    }, { onConflict: 'meeting_uuid' });
  }
  
  // UPSERT participants
  for (const participant of participants) {
    await supabase.from("bronze.zoom_participants").upsert({
      meeting_uuid: participant.meeting_uuid,
      participant_id: participant.id,
      name: participant.name,
      email: participant.email,
      join_time: participant.join_time,
      leave_time: participant.leave_time,
      duration_minutes: participant.duration,
      data: participant
    }, { onConflict: 'meeting_uuid,participant_id,join_time' });
  }
  
  // Trigger downstream processing
  await fetch('/api/process/attendance', {
    method: 'POST',
    body: JSON.stringify({
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString()
    })
  });
  
  return NextResponse.json({
    success: true,
    meetings: meetings.length,
    participants: participants.length,
    dateRange: { from: fromDate, to: toDate }
  });
}

async function fetchZoomData(
  fromDate: Date,
  toDate: Date
): Promise<{ meetings: any[]; participants: any[] }> {
  const accessToken = await getZoomAccessToken();
  const userId = process.env.ZOOM_USER_ID || 'me';
  
  let allMeetings: any[] = [];
  let allParticipants: any[] = [];
  
  // Paginate through meetings
  let nextPageToken: string | undefined;
  
  do {
    const response = await fetch(
      `https://api.zoom.us/v2/report/users/${userId}/meetings?` +
      `from=${fromDate.toISOString().split('T')[0]}&` +
      `to=${toDate.toISOString().split('T')[0]}&` +
      `page_size=300&` +
      (nextPageToken ? `next_page_token=${nextPageToken}` : ''),
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    const meetings = data.meetings || [];
    allMeetings = allMeetings.concat(meetings);
    
    // Fetch participants for each meeting
    for (const meeting of meetings) {
      const participants = await fetchMeetingParticipants(
        meeting.uuid,
        accessToken
      );
      allParticipants = allParticipants.concat(
        participants.map(p => ({ ...p, meeting_uuid: meeting.uuid }))
      );
    }
    
    nextPageToken = data.next_page_token;
  } while (nextPageToken);
  
  return { meetings: allMeetings, participants: allParticipants };
}

async function fetchMeetingParticipants(
  meetingUuid: string,
  accessToken: string
): Promise<any[]> {
  // URL-encode the UUID (contains slashes)
  const encodedUuid = encodeURIComponent(encodeURIComponent(meetingUuid));
  
  let allParticipants: any[] = [];
  let nextPageToken: string | undefined;
  
  do {
    const response = await fetch(
      `https://api.zoom.us/v2/report/meetings/${encodedUuid}/participants?` +
      `page_size=300&` +
      (nextPageToken ? `next_page_token=${nextPageToken}` : ''),
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    allParticipants = allParticipants.concat(data.participants || []);
    nextPageToken = data.next_page_token;
  } while (nextPageToken);
  
  return allParticipants;
}

async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID!;
  const clientId = process.env.ZOOM_CLIENT_ID!;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!;
  
  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  
  const data = await response.json();
  return data.access_token;
}
```

---

## Zoom Webhook Handler

### Webhook Events

**Subscribe to these Zoom webhook events:**
- `meeting.participant_joined` - Real-time join notification
- `meeting.participant_left` - Real-time leave notification
- `meeting.started` - Meeting start (optional, for meeting metadata)
- `meeting.ended` - Meeting end (optional, triggers reconciliation)

### Webhook Handler Implementation

**File:** `app/api/webhooks/zoom/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-zm-signature');
  const timestamp = request.headers.get('x-zm-request-timestamp');
  
  // Verify webhook signature
  if (!verifyZoomSignature(body, signature, timestamp)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  
  const event = JSON.parse(body);
  const supabase = await createClient();
  
  switch (event.event) {
    case 'meeting.participant_joined':
      await handleParticipantJoined(event.payload, supabase);
      break;
      
    case 'meeting.participant_left':
      await handleParticipantLeft(event.payload, supabase);
      break;
      
    case 'meeting.started':
      await handleMeetingStarted(event.payload, supabase);
      break;
      
    case 'meeting.ended':
      await handleMeetingEnded(event.payload, supabase);
      break;
      
    default:
      console.log(`Unhandled Zoom event: ${event.event}`);
  }
  
  return NextResponse.json({ received: true });
}

function verifyZoomSignature(
  body: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  if (!signature || !timestamp) return false;
  
  const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN!;
  const message = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac('sha256', secretToken)
    .update(message)
    .digest('hex');
  const computedSignature = `v0=${hash}`;
  
  return computedSignature === signature;
}

async function handleParticipantJoined(payload: any, supabase: any) {
  const { object } = payload;
  const participant = object.participant;
  
  // UPSERT to bronze layer (leave_time is null, still in meeting)
  await supabase.from("bronze.zoom_participants").upsert({
    meeting_uuid: object.uuid,
    participant_id: participant.id || participant.user_id,
    name: participant.user_name,
    email: participant.email,
    join_time: new Date(participant.join_time).toISOString(),
    leave_time: null, // Still in meeting
    duration_minutes: 0,
    data: payload
  }, { 
    onConflict: 'meeting_uuid,participant_id,join_time',
    ignoreDuplicates: false 
  });
  
  // Trigger live participant update (process current active participants)
  await triggerLiveParticipantUpdate(object.uuid);
}

async function handleParticipantLeft(payload: any, supabase: any) {
  const { object } = payload;
  const participant = object.participant;
  
  // Find the participant record with null leave_time (active session)
  const { data: activeRecord } = await supabase
    .from("bronze.zoom_participants")
    .select('*')
    .eq('meeting_uuid', object.uuid)
    .eq('participant_id', participant.id || participant.user_id)
    .is('leave_time', null)
    .order('join_time', { ascending: false })
    .limit(1)
    .single();
  
  if (activeRecord) {
    const leaveTime = new Date(participant.leave_time);
    const joinTime = new Date(activeRecord.join_time);
    const durationMinutes = Math.round((leaveTime.getTime() - joinTime.getTime()) / (1000 * 60));
    
    // Update with leave time and duration
    await supabase
      .from("bronze.zoom_participants")
      .update({
        leave_time: leaveTime.toISOString(),
        duration_minutes: durationMinutes,
        data: payload
      })
      .eq('id', activeRecord.id);
    
    // Trigger participant processing for this date
    const prickleDate = leaveTime.toISOString().split('T')[0];
    await fetch('/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDate: prickleDate,
        toDate: prickleDate
      })
    });
  }
}

async function handleMeetingStarted(payload: any, supabase: any) {
  const { object } = payload;
  
  // UPSERT meeting metadata
  await supabase.from("bronze.zoom_meetings").upsert({
    meeting_uuid: object.uuid,
    meeting_id: object.id.toString(),
    topic: object.topic,
    start_time: new Date(object.start_time).toISOString(),
    end_time: null, // Meeting still in progress
    duration_minutes: 0,
    participants_count: 0,
    data: payload
  }, { onConflict: 'meeting_uuid' });
}

async function handleMeetingEnded(payload: any, supabase: any) {
  const { object } = payload;
  
  // Update meeting with end time
  const startTime = new Date(object.start_time);
  const endTime = new Date(object.end_time);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
  
  await supabase
    .from("bronze.zoom_meetings")
    .update({
      end_time: endTime.toISOString(),
      duration_minutes: durationMinutes,
      data: payload
    })
    .eq('meeting_uuid', object.uuid);
  
  // Trigger reconciliation for this specific meeting (safety net)
  // This will fetch participant data from Reports API to catch any missed webhooks
  const prickleDate = endTime.toISOString().split('T')[0];
  await reconcileSingleMeeting(object.uuid, prickleDate);
}

async function triggerLiveParticipantUpdate(meetingUuid: string) {
  // Optional: Update live dashboard showing current participants
  // This could trigger a real-time update to a "Who's in prickles now?" view
  console.log(`Live participant update for meeting ${meetingUuid}`);
}

async function reconcileSingleMeeting(meetingUuid: string, date: string) {
  // Fetch participant data from Reports API for this specific meeting
  // This catches any missed join/leave webhooks
  const accessToken = await getZoomAccessToken();
  const participants = await fetchMeetingParticipants(meetingUuid, accessToken);
  
  const supabase = await createClient();
  for (const participant of participants) {
    await supabase.from("bronze.zoom_participants").upsert({
      meeting_uuid: meetingUuid,
      participant_id: participant.id,
      name: participant.name,
      email: participant.email,
      join_time: participant.join_time,
      leave_time: participant.leave_time,
      duration_minutes: participant.duration,
      data: participant
    }, { onConflict: 'meeting_uuid,participant_id,join_time' });
  }
  
  // Trigger attendance processing for this date
  await fetch('/api/process/attendance', {
    method: 'POST',
    body: JSON.stringify({ fromDate: date, toDate: date })
  });
}
```

### Zoom Webhook Configuration

**In Zoom Marketplace:**
1. Create Server-to-Server OAuth app
2. Add Feature > Event Subscriptions
3. Subscribe to events:
   - `meeting.participant_joined`
   - `meeting.participant_left`
   - `meeting.started`
   - `meeting.ended`
4. Set Event notification endpoint: `https://your-domain.com/api/webhooks/zoom`
5. Copy "Secret Token" for signature verification

---

## CSV Import (Local Testing Only)

**Purpose:** Bootstrap local development and testing, not for production

**File:** `app/api/import/calendar-csv/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parse } from "csv-parse/sync";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  
  const content = await file.text();
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true
  });
  
  const supabase = await createClient();
  
  for (const record of records) {
    await supabase.from("bronze.calendar_events").upsert({
      google_event_id: record.event_id || `csv-${Date.now()}-${Math.random()}`,
      calendar_id: 'local-import',
      summary: record.summary,
      start_time: record.start_time,
      end_time: record.end_time,
      data: record
    }, { onConflict: 'google_event_id' });
  }
  
  return NextResponse.json({
    success: true,
    imported: records.length
  });
}
```

**Similar routes for:**
- `/api/import/zoom-meetings-csv` - Import Zoom meetings from CSV
- `/api/import/zoom-participants-csv` - Import Zoom participants from CSV

---

## Testing Requirements

### Idempotency Tests

**Location:** `tests/api/idempotency/calendar-import.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { createClient } from '@/lib/supabase/server';

describe('Calendar Import Idempotency', () => {
  beforeEach(async () => {
    const supabase = await createClient();
    await supabase.from('bronze.calendar_events').delete().neq('id', '0');
  });
  
  test('re-importing same event does not create duplicates', async () => {
    const supabase = await createClient();
    const eventData = {
      google_event_id: 'event_123',
      calendar_id: 'primary',
      summary: 'Morning Writing',
      start_time: '2026-04-21T09:00:00Z',
      end_time: '2026-04-21T11:00:00Z',
      data: { id: 'event_123', summary: 'Morning Writing' }
    };
    
    // First import
    await supabase.from('bronze.calendar_events').upsert(
      eventData,
      { onConflict: 'google_event_id' }
    );
    
    const { count: count1 } = await supabase
      .from('bronze.calendar_events')
      .select('*', { count: 'exact' })
      .eq('google_event_id', 'event_123');
    
    // Second import (same data)
    await supabase.from('bronze.calendar_events').upsert(
      eventData,
      { onConflict: 'google_event_id' }
    );
    
    const { count: count2 } = await supabase
      .from('bronze.calendar_events')
      .select('*', { count: 'exact' })
      .eq('google_event_id', 'event_123');
    
    // No duplicates
    expect(count2).toBe(count1);
    expect(count1).toBe(1);
  });
  
  test('re-importing with changed data updates record', async () => {
    const supabase = await createClient();
    
    // Import initial data
    await supabase.from('bronze.calendar_events').upsert({
      google_event_id: 'event_123',
      calendar_id: 'primary',
      summary: 'Old Title',
      start_time: '2026-04-21T09:00:00Z',
      end_time: '2026-04-21T11:00:00Z',
      data: { summary: 'Old Title' }
    }, { onConflict: 'google_event_id' });
    
    // Import updated data
    await supabase.from('bronze.calendar_events').upsert({
      google_event_id: 'event_123',
      calendar_id: 'primary',
      summary: 'New Title',
      start_time: '2026-04-21T09:00:00Z',
      end_time: '2026-04-21T11:00:00Z',
      data: { summary: 'New Title' }
    }, { onConflict: 'google_event_id' });
    
    // Should reflect updated data
    const { data: event } = await supabase
      .from('bronze.calendar_events')
      .select('summary')
      .eq('google_event_id', 'event_123')
      .single();
    
    expect(event.summary).toBe('New Title');
    
    // Should only have one record
    const { count } = await supabase
      .from('bronze.calendar_events')
      .select('*', { count: 'exact' })
      .eq('google_event_id', 'event_123');
    
    expect(count).toBe(1);
  });
});

describe('Zoom Import Idempotency', () => {
  test('re-importing same participant join does not create duplicates', async () => {
    const supabase = await createClient();
    const participantData = {
      meeting_uuid: 'meeting_123',
      participant_id: 'participant_456',
      name: 'John Doe',
      email: 'john@example.com',
      join_time: '2026-04-21T09:00:00Z',
      leave_time: '2026-04-21T11:00:00Z',
      duration_minutes: 120,
      data: {}
    };
    
    // First import
    await supabase.from('bronze.zoom_participants').upsert(
      participantData,
      { onConflict: 'meeting_uuid,participant_id,join_time' }
    );
    
    // Second import (same data)
    await supabase.from('bronze.zoom_participants').upsert(
      participantData,
      { onConflict: 'meeting_uuid,participant_id,join_time' }
    );
    
    const { count } = await supabase
      .from('bronze.zoom_participants')
      .select('*', { count: 'exact' })
      .eq('meeting_uuid', 'meeting_123')
      .eq('participant_id', 'participant_456');
    
    // Should only have one record
    expect(count).toBe(1);
  });
  
  test('allows multiple join records for same participant (leave/rejoin)', async () => {
    const supabase = await createClient();
    
    // First join
    await supabase.from('bronze.zoom_participants').upsert({
      meeting_uuid: 'meeting_123',
      participant_id: 'participant_456',
      name: 'John Doe',
      join_time: '2026-04-21T09:00:00Z',
      leave_time: '2026-04-21T09:30:00Z',
      duration_minutes: 30,
      data: {}
    }, { onConflict: 'meeting_uuid,participant_id,join_time' });
    
    // Second join (after bathroom break)
    await supabase.from('bronze.zoom_participants').upsert({
      meeting_uuid: 'meeting_123',
      participant_id: 'participant_456',
      name: 'John Doe',
      join_time: '2026-04-21T10:00:00Z',
      leave_time: '2026-04-21T11:00:00Z',
      duration_minutes: 60,
      data: {}
    }, { onConflict: 'meeting_uuid,participant_id,join_time' });
    
    const { count } = await supabase
      .from('bronze.zoom_participants')
      .select('*', { count: 'exact' })
      .eq('meeting_uuid', 'meeting_123')
      .eq('participant_id', 'participant_456');
    
    // Should have TWO records (different join times)
    expect(count).toBe(2);
  });
});
```

### Webhook Tests

**Location:** `tests/integration/webhooks/zoom.test.ts`

```typescript
describe('Zoom Webhook Handler', () => {
  test('participant_joined creates participant record with null leave_time', async () => {
    const supabase = await createClient();
    
    const joinEvent = {
      event: 'meeting.participant_joined',
      payload: {
        object: {
          uuid: 'meeting_123',
          participant: {
            id: 'participant_456',
            user_name: 'John Doe',
            email: 'john@example.com',
            join_time: '2026-04-22T09:00:00Z'
          }
        }
      }
    };
    
    await fetch('/api/webhooks/zoom', {
      method: 'POST',
      body: JSON.stringify(joinEvent),
      headers: {
        'x-zm-signature': generateZoomSignature(joinEvent),
        'x-zm-request-timestamp': Date.now().toString()
      }
    });
    
    const { data: participant } = await supabase
      .from('bronze.zoom_participants')
      .select('*')
      .eq('meeting_uuid', 'meeting_123')
      .eq('participant_id', 'participant_456')
      .single();
    
    expect(participant).toBeTruthy();
    expect(participant.leave_time).toBeNull();
    expect(participant.duration_minutes).toBe(0);
  });
  
  test('participant_left updates leave_time and duration', async () => {
    const supabase = await createClient();
    
    // First, participant joins
    await supabase.from('bronze.zoom_participants').insert({
      meeting_uuid: 'meeting_123',
      participant_id: 'participant_456',
      name: 'John Doe',
      join_time: '2026-04-22T09:00:00Z',
      leave_time: null,
      duration_minutes: 0,
      data: {}
    });
    
    // Then, participant leaves
    const leaveEvent = {
      event: 'meeting.participant_left',
      payload: {
        object: {
          uuid: 'meeting_123',
          participant: {
            id: 'participant_456',
            leave_time: '2026-04-22T11:00:00Z'
          }
        }
      }
    };
    
    await fetch('/api/webhooks/zoom', {
      method: 'POST',
      body: JSON.stringify(leaveEvent),
      headers: {
        'x-zm-signature': generateZoomSignature(leaveEvent),
        'x-zm-request-timestamp': Date.now().toString()
      }
    });
    
    const { data: participant } = await supabase
      .from('bronze.zoom_participants')
      .select('*')
      .eq('meeting_uuid', 'meeting_123')
      .eq('participant_id', 'participant_456')
      .single();
    
    expect(participant.leave_time).toBe('2026-04-22T11:00:00Z');
    expect(participant.duration_minutes).toBe(120); // 2 hours
  });
  
  test('rejects webhooks with invalid signature', async () => {
    const event = { event: 'meeting.participant_joined', payload: {} };
    
    const response = await fetch('/api/webhooks/zoom', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: {
        'x-zm-signature': 'invalid-signature',
        'x-zm-request-timestamp': Date.now().toString()
      }
    });
    
    expect(response.status).toBe(401);
  });
});
```

### Pagination Tests

**Location:** `tests/integration/reconciliation/pagination.test.ts`

```typescript
describe('Reconciliation Pagination', () => {
  test('handles 1000+ calendar events without timeout', async () => {
    // This requires actual Google Calendar API or mock
    // Test that pagination works correctly
  });
  
  test('handles 10,000+ zoom participants without timeout', async () => {
    // This requires actual Zoom API or mock
    // Test that nested pagination (meetings → participants) works
  });
});
```

---

## Deployment

### Environment Variables

```env
# Google Calendar
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_CALENDAR_ID=primary

# Zoom
ZOOM_ACCOUNT_ID=your_account_id
ZOOM_CLIENT_ID=your_client_id
ZOOM_CLIENT_SECRET=your_client_secret
ZOOM_USER_ID=me
ZOOM_WEBHOOK_SECRET_TOKEN=your_webhook_secret

# Cron authentication
CRON_SECRET=random_secret_for_cron_jobs
```

### Vercel Cron Configuration

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/reconcile-calendar",
      "schedule": "0 1 * * *"
    },
    {
      "path": "/api/cron/reconcile-zoom",
      "schedule": "0 2 * * *"
    }
  ]
}
```

---

## Success Criteria

**Bronze Layer:**
- ✅ Calendar events UPSERT correctly by `google_event_id`
- ✅ Zoom meetings UPSERT correctly by `meeting_uuid`
- ✅ Zoom participants UPSERT correctly by `(meeting_uuid, participant_id, join_time)`
- ✅ Re-importing same data doesn't create duplicates
- ✅ Multiple join records allowed for same participant (leave/rejoin)

**Webhooks (Real-time):**
- ✅ Zoom participant_joined webhook creates participant record (leave_time = null)
- ✅ Zoom participant_left webhook updates leave_time and duration
- ✅ Google Calendar webhook updates calendar_events table
- ✅ Webhook signature verification prevents unauthorized requests
- ✅ Triggers immediate Silver layer processing (attendance for that date)
- ✅ Meeting ended triggers reconciliation for that specific meeting (safety net)

**Reconciliation (Safety Net):**
- ✅ Daily cron fetches all calendar events (last 3 months + next month)
- ✅ Daily cron fetches all Zoom meetings and participants (last 3 months)
- ✅ Handles pagination (1000+ events, 10,000+ participants)
- ✅ Catches any webhooks that were missed or failed
- ✅ Triggers downstream processing after import
- ✅ Completes within 300s timeout

**Pattern Consistency:**
- ✅ Webhooks + reconciliation pattern matches Kajabi and Stripe
- ✅ Webhooks provide real-time updates (99% of cases)
- ✅ Reconciliation fixes data drift (safety net)
- ✅ System self-heals within 24 hours

**CSV Import (Local Testing):**
- ✅ Can bootstrap local database from CSV files
- ✅ Supports same idempotency as API imports
- ✅ Not used in production (only local dev)

---

## Next Steps

1. ✅ Review this spec
2. Implement Bronze schema migrations
3. Build Zoom webhook handler (participant_joined, participant_left, meeting_started, meeting_ended)
4. Build Google Calendar webhook handler (event updates)
5. Build Google Calendar reconciliation cron (safety net)
6. Build Zoom reconciliation cron (safety net)
7. Build CSV import routes (local testing only)
8. Write idempotency tests
9. Write webhook signature verification tests
10. Write pagination tests
11. Configure webhooks in Zoom Marketplace and Google Calendar API
12. Deploy and test with real webhooks + reconciliation
13. Move to [Attendance Data Quality](./attendance-data-quality.md) spec

# Integration Sequence Diagrams

How each external integration gets data into the Bronze layer and triggers Silver
reprocessing. Two flavors per integration where applicable:

- **Real-time** — triggered by an inbound webhook from the provider
- **Cron** — triggered nightly by Vercel Cron as a reconciliation backstop

All webhook handlers follow the same shape: verify the signature, respond `200 OK`
immediately (providers retry aggressively on non-2xx/slow responses), then do the
actual work asynchronously (fire-and-forget or `setTimeout`). All cron endpoints are
thin `GET` wrappers — Vercel Cron only issues `GET` requests — that call the same
`trigger*` functions used elsewhere, authenticated via `CRON_SECRET` in
`lib/supabase/api-auth.ts`. See `INTEGRATION_LINKS.md` for webhook URLs/secrets and
`MEDALLION_ARCHITECTURE.md` for the layer model these flows populate.

Downstream Silver reprocessing dependencies (which Bronze/Local change triggers which
Silver table, and the required order) are declared centrally in
`lib/processing/trigger.ts`'s `SILVER_DEPENDENCIES` map — that map is the source of
truth for the reprocessing steps shown below.

---

## Zoom

**Webhook:** `POST /api/webhooks/zoom` (HMAC-SHA256 via `x-zm-signature`)<br/>
**Cron:** `GET /api/reconcile/zoom` — daily at 2:30am, trailing 90-day window

### Real-time flow

```mermaid
sequenceDiagram
    autonumber
    participant Zoom
    participant WH as /api/webhooks/zoom
    participant Import as /api/import/zoom
    participant API as Zoom REST API
    participant Bronze as bronze.zoom_meetings<br/>bronze.zoom_attendees
    participant Process as /api/process/attendance
    participant Silver as prickles (PUPs)<br/>prickle_attendance

    Zoom->>WH: POST meeting.ended / participant_left<br/>(x-zm-signature, x-zm-request-timestamp)
    WH->>WH: verify HMAC-SHA256 signature
    WH-->>Zoom: 200 OK { received: true }
    Note over WH: setTimeout 10s<br/>(lets Zoom finalize meeting data)
    WH->>Import: triggerZoomImport({fromDate, toDate})<br/>direct in-process call (no HTTP hop)
    Import->>API: listMeetings() + getParticipants()
    API-->>Import: meeting metadata + participant list
    Import->>Bronze: upsert zoom_meetings (onConflict meeting_uuid)
    Import->>Bronze: insert zoom_attendees
    Import->>Process: triggerReprocessing('zoom_attendees', 'bronze', {dateRange})
    Process->>Process: match attendees to members,<br/>split meetings into scheduled segments + PUPs
    Process->>Silver: reprocess_prickle_attendance_atomic()<br/>(DELETE + INSERT, single transaction)
```

### Cron flow

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Vercel Cron<br/>(0 30 2 * * daily)
    participant Recon as /api/reconcile/zoom
    participant Import as /api/import/zoom
    participant Rest as ...same as real-time flow<br/>from here down

    Cron->>Recon: GET (Authorization: Bearer CRON_SECRET)
    Recon->>Recon: requireAdmin() — cron secret bypasses role check
    Recon->>Import: triggerZoomImport({fromDate: now-90d, toDate: now})
    Import->>Rest: fetch, upsert Bronze, reprocess attendance
```

**Why a cron backstop:** the webhook only fires on `meeting.ended` /
`participant_left`, and Zoom's API can be briefly inconsistent right after a
meeting ends. The nightly job re-pulls a trailing 90-day window so any missed or
malformed webhook self-heals within 24 hours.

---

## Slack

**Webhook:** `POST /api/webhooks/slack` (HMAC-SHA256 via `x-slack-signature`, 5-minute replay window)<br/>
**Cron:** none — Slack has no scheduled reconciliation job today (not in `vercel.json`)

### Real-time flow

```mermaid
sequenceDiagram
    autonumber
    participant Slack
    participant WH as /api/webhooks/slack
    participant Bronze as bronze.slack_messages<br/>bronze.slack_reactions
    participant Process as /api/process/slack
    participant Silver as member_activities

    Slack->>WH: POST message / reaction_added / reaction_removed<br/>(x-slack-signature, x-slack-request-timestamp)
    WH->>WH: verify signature + timestamp within 5 min
    WH-->>Slack: 200 OK { received: true }
    alt message or reaction_added
        WH->>Bronze: upsert slack_messages / slack_reactions<br/>(service-role client, onConflict natural key)
    else reaction_removed
        WH->>Bronze: delete matching slack_reactions row
    end
    WH->>Process: triggerReprocessing('slack_messages', 'bronze',<br/>{dateRange: eventTs ±1 day}) — fire-and-forget
    Process->>Process: match Slack users to members,<br/>transform messages/reactions to activities
    Process->>Silver: DELETE existing activities in range,<br/>then INSERT fresh (reprocessable)
```

### Manual backfill (admin-triggered, not scheduled)

There is no cron for Slack. Historical/bulk import is manual only, via two admin
routes that both end by calling the same `triggerReprocessing('slack_messages', ...)`
as the webhook:

- `POST /api/import/slack` — imports a Slack export archive
- `POST /api/import/slack-api` — backfills via the Slack Web API (users, channels,
  messages, reactions) for a date range

```mermaid
sequenceDiagram
    autonumber
    participant Admin
    participant Import as /api/import/slack-api
    participant API as Slack Web API
    participant Bronze as bronze.slack_users/channels/<br/>messages/reactions
    participant Process as /api/process/slack
    participant Silver as member_activities

    Admin->>Import: POST { fromDate, toDate } (admin session)
    Import->>API: users.list, conversations.list,<br/>conversations.history, reactions.get
    API-->>Import: users, channels, messages, reactions
    Import->>Bronze: upsert bronze.slack_* tables
    Import->>Process: triggerReprocessing('slack_messages', 'bronze', {dateRange})
    Process->>Silver: DELETE + INSERT member_activities in range
```

---

## Google Calendar

**Webhook:** `POST /api/webhooks/calendar` (token via `x-goog-channel-token`, push channel registered manually — see `WEBHOOK_SETUP.md`)<br/>
**Cron:** `GET /api/reconcile/calendar` — daily at 2am, ±90-day window

### Real-time flow

```mermaid
sequenceDiagram
    autonumber
    participant GCal as Google Calendar
    participant WH as /api/webhooks/calendar
    participant Import as /api/import/calendar
    participant API as Google Calendar API
    participant Bronze as bronze.calendar_events
    participant ProcCal as /api/process/calendar
    participant ProcAtt as /api/process/attendance
    participant Silver as prickles<br/>prickle_attendance

    GCal->>WH: POST push notification<br/>(x-goog-channel-id, x-goog-resource-state)
    WH->>WH: validate headers + channel token
    alt resourceState == "sync"
        WH-->>GCal: 200 OK (initial channel handshake, no-op)
    else resourceState == "exists" | "not_exists"
        WH-->>GCal: 200 OK { received: true, triggered: "calendar_sync" }
        WH->>Import: triggerCalendarSync({daysBack:30, daysForward:90}) — fire-and-forget
        Note over WH,Import: Payload has no event body,<br/>so the full window is re-synced from the API
        Import->>API: listEvents(calendarId, timeMin, timeMax)
        API-->>Import: event list
        Import->>Bronze: upsert calendar_events (onConflict google_event_id)
        Import->>ProcCal: triggerReprocessing('calendar_events', 'bronze', {dateRange})
        ProcCal->>Silver: reprocess_prickles_atomic() (DELETE + INSERT)
        Note over ProcCal,ProcAtt: calendar_events changes are a special case in<br/>SILVER_DEPENDENCIES — they also invalidate attendance<br/>(reprocessed prickles get new UUIDs)
        ProcCal->>ProcAtt: cascade: process attendance for same range
        ProcAtt->>Silver: reprocess_prickle_attendance_atomic()
    end
```

### Cron flow

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Vercel Cron<br/>(0 2 * * * daily)
    participant Recon as /api/reconcile/calendar
    participant Import as /api/import/calendar
    participant Rest as ...same as real-time flow<br/>from here down

    Cron->>Recon: GET (Authorization: Bearer CRON_SECRET)
    Recon->>Recon: requireAdmin() — cron secret bypasses role check
    Recon->>Import: triggerCalendarSync({daysBack:90, daysForward:90})
    Import->>Rest: fetch, upsert Bronze, reprocess prickles + attendance
```

**Why a cron backstop:** Google's push channels expire (~7 days) and require manual
re-registration (`WEBHOOK_SETUP.md`); the nightly job with a wider ±90-day window
covers any gap while a channel is dead or a notification is dropped.

---

## Kajabi (Members)

**Webhook:** none in practice — Kajabi's webhooks only fire on "Payment Succeeded" /
"Cart Purchase" and aren't wired up (see `INTEGRATION_LINKS.md`). Member state is
sourced entirely by pulling the Kajabi API.<br/>
**Cron:** `GET /api/reconcile/members` — daily at 3am, full refresh (no date scoping — `members` is an identity entity, not event-scoped)

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Vercel Cron<br/>(0 3 * * * daily)<br/>— or Admin "Sync Now" button
    participant Recon as /api/reconcile/members
    participant Import as /api/import/kajabi
    participant API as Kajabi API
    participant Bronze as bronze.kajabi_contacts<br/>bronze.kajabi_customers<br/>bronze.kajabi_purchases<br/>bronze.kajabi_offers
    participant Proc as /api/process/members
    participant Silver as members (UPSERT by email,<br/>preserves UUIDs via<br/>reprocess_members_atomic)
    participant ProcAtt as /api/process/attendance

    Cron->>Recon: GET (Authorization: Bearer CRON_SECRET)
    Recon->>Recon: requireAdmin() — cron secret bypasses role check
    Recon->>Import: triggerKajabiSync()
    Import->>API: fetchAllContacts / Customers / Subscriptions / Offers (parallel)
    API-->>Import: contacts, customers, purchases, offers
    Import->>Bronze: upsert kajabi_contacts/customers/purchases/offers
    Import->>Proc: triggerReprocessing('kajabi_contacts', 'bronze')
    Proc->>Proc: join contacts+customers+purchases+offers,<br/>resolve member_email_aliases, join stripe_customers<br/>for stripe_customer_id, apply staff overrides
    Proc->>Silver: reprocess_members_atomic(new_data)
    Proc-->>Recon: 200 OK (response sent)
    Note over Proc,ProcAtt: after() — runs post-response, doesn't block the request
    Proc->>ProcAtt: triggerAttendanceReprocessing(last 90 days)
    ProcAtt->>ProcAtt: newly-added/matchable members<br/>get historical attendance backfilled
```

**Note:** the admin UI's "Sync Now" button calls `POST /api/import/kajabi` directly
(same handler `triggerKajabiSync()` invokes) — same flow, different trigger.

---

## Stripe (comparison only — no cron, no webhook)

Stripe is **not** part of the automated Bronze→Silver pipeline. It exists purely so
admin analysis routes (`/api/analyze/stripe-orphans`,
`/api/analyze/kajabi-stripe-comparison`) can cross-check Kajabi's subscription state
against Stripe's, and so `members.stripe_customer_id` can be populated by an email
join during member processing. Import is manual-only and never calls
`triggerReprocessing`.

```mermaid
sequenceDiagram
    autonumber
    participant Admin
    participant Import as /api/import/stripe
    participant API as Stripe API
    participant Bronze as bronze.stripe_customers<br/>bronze.stripe_products<br/>bronze.stripe_subscriptions

    Admin->>Import: POST (admin session)
    Import->>API: fetchAllCustomers / Products / Subscriptions
    API-->>Import: customers, products, subscriptions
    Import->>Bronze: upsert bronze.stripe_* tables
    Note over Import,Bronze: No Silver trigger — read only by<br/>/api/process/members (stripe_customer_id lookup)<br/>and /api/analyze/* comparison routes
```

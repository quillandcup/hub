---
paths:
  - "src/app/api/process/**"
  - "src/app/api/import/**"
  - "src/app/api/reconcile/**"
  - "src/app/api/webhooks/**"
  - "supabase/migrations/**"
  - "tests/api/reprocessability/**"
  - "tests/api/idempotency/**"
---

### Data Pipeline Reprocessability

**CRITICAL PRINCIPLE**: Silver layer processing MUST be fully reprocessable from Bronze + Local sources.

**Why this matters**:
- Deleted events must be removed from Silver layer when reprocessing
- UPSERT patterns leave orphaned data (e.g., deleted calendar event stays in prickles)
- The pipeline must always reflect current truth from ALL sources (Bronze + Local)

**Note on `members`**: Former members are intentionally retained (status set to cancelled) rather than deleted, because `prickle_attendance.member_id` has `ON DELETE CASCADE` — deleting a member would wipe their full attendance history. `attendance` uses the canonical DELETE + INSERT pattern; `prickles` upsert on their source key and delete orphans, which keeps their ids stable.

**Required Pattern for ALL Silver Processing**:

```typescript
// ✅ CORRECT: DELETE + INSERT pattern
export async function POST(request: NextRequest) {
  // 1. Load Bronze data (imports)
  const bronzeData = await supabase.from("bronze_table").select("*");
  
  // 2. Load Local data (operational)
  const localData = await supabase.from("local_table").select("*");
  
  // 3. DELETE existing Silver data in scope
  await supabase
    .from("silver_table")
    .delete()
    .gte("date_field", fromDate)  // Scope by date range or condition
    .lte("date_field", toDate);
  
  // 4. Reconcile Bronze + Local → Silver in memory
  const silverData = reconcileSources(bronzeData, localData);
  
  // 5. INSERT fresh Silver data
  await supabase.from("silver_table").insert(silverData);
}

// ❌ WRONG: UPSERT pattern (leaves orphaned data)
await supabase.from("silver_table").upsert(silverData, { onConflict: "id" });
```

**Current Implementation Status**:

1. **`/api/process/members`** ✅ — **exception to DELETE + INSERT**
   - Uses `reprocess_members_atomic` SQL function instead of DELETE + INSERT
   - UPDATE existing members matched by `kajabi_id` (handles email/name changes)
   - UPSERT new members by email (staff and brand-new contacts)
   - **Does NOT delete members missing from new data** — former members stay in the table with their status updated to cancelled, preserving `prickle_attendance` history via the `ON DELETE CASCADE` FK
   - Scope: All members (full refresh of fields, never a row delete)

2. **`/api/process/calendar`** ✅
   - UPSERT calendar prickles from `calendar_events` on `calendar_event_id` (existing prickles keep their id)
   - DELETE prickles in the date range whose calendar event is gone (orphans)
   - Scope: Date range (fromDate, toDate)

3. **`/api/process/attendance`** ✅
   - DELETE attendance in date range
   - UPSERT PUPs (zoom-sourced prickles) on `zoom_meeting_uuid` (+ start/end), DELETE orphaned PUPs
   - INSERT fresh attendance from `zoom_attendees` in date range
   - Scope: Date range (fromDate, toDate)

**Bronze Layer Idempotency** (different pattern):

Bronze imports use UPSERT or timestamp-based append for idempotency:

```typescript
// ✅ Calendar sync: UPSERT by google_event_id
await supabase.from("calendar_events").upsert(events, { 
  onConflict: "google_event_id" 
});

// ✅ Zoom import: UPSERT by meeting_uuid
await supabase.from("zoom_meetings").upsert(meetings, {
  onConflict: "uuid"
});

// ✅ Members import: Append with imported_at timestamp (snapshots)
await supabase.from("kajabi_members").insert({ 
  ...memberData, 
  imported_at: new Date() 
});
// Processing uses latest snapshot, making it idempotent at processing level
```

**Soft delete in Bronze and Local, not hard delete**: When a source stops reporting something (a Slack message or reaction removed, a member leaving a channel), mark it rather than deleting the row. The soft-delete column is always named `deleted_at` (not `removed_at` or another synonym), so every table is read the same way: `deleted_at IS NULL` means live. A timestamp that is a fact about the thing rather than a tombstone keeps its own name (`archived_at`, `dismissed_at`, a membership's `left_at`). Silver can still DELETE + INSERT: it re-derives the soft-deleted state from Bronze/Local on every run, so nothing is lost. Hard delete only when the row has no history worth keeping, or when a Silver rebuild re-creates it. Before marking something deleted because it's missing from a fetch, confirm that fetch fully succeeded for that scope, or a failed API call reads as a mass deletion.

**Members' own business resources soft delete too** (`/privacy` tells them once that a delete keeps the row until they ask us to remove it; delete screens carry no disclaimer). Today that is writing projects (with their goals and entries), writing goals, progress entries, books and awards: the delete sets `deleted_at` (the audit log records it as a delete) and nothing is removed until a request scrubs the columns. Two layers keep a deleted row out of sight: every app read filters `deleted_at IS NULL` (in the writing repository, `src/lib/data/writing.ts`, and the bookshelf and awards queries), and the "everyone can view" policies on `member_books` and `member_awards` hide it from other members. The owner and admins still see it through the "manage their own" policy, which is also what lets the soft-delete `UPDATE ... RETURNING` work, so the app filter is not optional. A unique constraint that should allow a re-create is partial (`WHERE deleted_at IS NULL`, as on `member_books.project_id`). A new member-deletable resource follows the same pattern; the rule is independent records only: private notes, hand-added calendar items and starting balances stay hard deletes on purpose (settings and in-place edits overwrite; reasons in `docs/TODO.md`, "Soft-delete the rest of the member-written tables").

**Nothing through webhooks alone**: Every webhook-handled event type (created, changed, deleted, membership, etc.) must also be caught by a pull-based import that runs in the nightly reconciliation cron and from the manual admin import. Webhooks and on-demand incremental fetches (e.g. fetch a missing thread when a webhook references a message we don't have) are latency optimizations layered on top, never the only path. New integrations follow this; extending on-demand incremental fetch to every source is tracked in `docs/TODO.md`.

**Testing Requirements**:

Every Silver processing route MUST have reprocessability tests verifying:
1. Initial processing creates records
2. Reprocessing with deleted source data removes Silver records
3. Reprocessing with changed source data updates Silver records
4. DELETE + INSERT pattern (not UPSERT) - orphan detection

See: `tests/api/reprocessability/`

Every Bronze import route MUST have idempotency tests verifying:
1. First import creates records
2. Re-importing same data does NOT create duplicates
3. Re-importing with changed data updates correctly (UPSERT) or creates new snapshots (append-only)
4. Multiple import cycles are safe

See: `tests/api/idempotency/`

---
paths:
  - "supabase/migrations/**"
  - "lib/activity-feed.ts"
  - "lib/*-events.ts"
  - "lib/audit*.ts"
  - "app/**/actions.ts"
  - "app/api/**/route.ts"
  - "supabase/tests/database/**"
---

### Audit Log: Record the Intent, Not the Noise

**RULE**: The audit log records what someone *meant*, once, with the before and after, and not every row that changed because of it. A change that rewrites many rows (reordering a list, publishing a module whose lessons' states then follow, moving a subtree) is **one entry for the thing that was acted on**, written as the person who did it. Full explanation and the worked examples: `docs/architecture/ACTIVITY_AND_AUDIT_LOG.md`, "Record the intent, not the noise".

- **Leave mechanical columns out of the per-row trigger.** A column that only follows from something else (`position` in a reordered list, a `state` derived from a setting above it, `updated_at`) goes in the `WHEN` clause's exclusions (`(to_jsonb(OLD) - 'position' - 'state' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - ...)`), so a rewrite of it writes no rows.
- **The intent is one entry.** Either the row's own change carries it (the setting that was changed shows as that item's delta), or, when no single row does (a reorder), a `SECURITY DEFINER` database function that checks the caller itself writes one entry: the list it was done in as `entity_label`, `changes` as `{"order": {"old": [...], "new": [...]}}`. Add its sentence to `describeRow` (`lib/activity-feed.ts`) so the feed reads "reordered the 4 lessons in “Week 1”".
- **Write as the person, not the service role.** An admin's change goes through their own client (or a function that reads their identity), so it isn't recorded as `system`.
- **No entry when nothing changed, and none for a refused or stale attempt.**
- **Test both halves**: that the one entry is there (who, what, before and after) and that the per-row noise isn't (pgTAP: see `supabase/tests/database/course_editor_outline.test.sql`).

### A Feature Launches With Its Events in the Activity Log

**RULE**: A feature that records something about a member, or that staff do to a member's record, ships with its events in the Activity Log (`/admin/activity` and the member's Activity tab), checked before launch, not as a later TODO. Staff reading a member's history must not have to guess what the feature did.

- **Write the events.** A `member_activities` row for each event worth a line (`actor_kind` member, staff or system; best effort beside the primary write), or an audit row where the audit rules say (a change to a record: the trigger, one entry for the intent). Two rows for one fact are fine only when the feed lists one of them.
- **Say each as a plain sentence** in `describeRow` (`lib/activity-feed.ts`), people by `getMemberDisplayName`, and **never anything a person typed** (a note, a reason, message text) in the sentence, `description` or `data`/`changes`: redact audit columns (`audit_row_change`'s third argument).
- **Test it:** the sentences in a unit test (every event, a name with `&` and `<`, no typed text), the rows an action writes in that action's test, and the trigger and the feed in pgTAP. Hedgie Care is the pattern (`lib/care-events.ts`, `tests/lib/care-events.test.ts`, `supabase/tests/database/care_activity_log.test.sql`).
- **Look before you ship:** run each action once and read the Activity Log. Detail: `docs/architecture/ACTIVITY_AND_AUDIT_LOG.md`, "A feature launches with its events in the activity log".

### Every Action a Person Takes Is in the Activity Log

**RULE**: Anything a person does that changes the Hub's data (a server action, an API route, a database function an admin calls) leaves an entry in the Activity Log, and it reads as a plain sentence. This is not only for features about members: admin tools count (the page builder, templates, imports and exports, settings, flags, programs, events, courses). A change nobody can find afterwards is a bug, whoever made it. Before you ship an action, ask "where does this show up in `/admin/activity`?"; "nowhere" is the wrong answer.

- **Pick the mechanism.** If the action changes a row, the table's `audit_row_change` trigger is the entry (one entry for the intent, per "Record the Intent, Not the Noise" above). If it changes no single row (an export, a dry run that wrote nothing is not an action; a bulk send, a reorder, a replace-the-draft), write one event through a `SECURITY DEFINER` function or a `member_activities` row, as the person. Don't rely on the analytics event (`usage-analytics.md`): that counts usage and is not the staff-facing history.
- **A sentence for every kind of entry**, in `describeRow` with a label in `ENTITY_LABELS` (`lib/activity-feed.ts`). An entity type with no sentence falls back to a generic "changed <entity>" and counts as missing. Name the thing by its title or name, people by `getMemberDisplayName`, and say what happened ("published the page “Home”", "saved version 3 of the template “Homepage”"), not that a row changed.
- **Never what a person typed or the content they made**: not a note, a reason, message text, page content or a description in the sentence, `description`, `data` or `changes`. Redact those audit columns (`audit_row_change`'s third argument); the content lives in the record or its versions, not in the log.
- **What does not need an entry**: reads, drafts saved on every keystroke (autosave: the intent is the publish or the restore), a change that wrote nothing (no entry for a refused, stale or identical attempt), and rows that only follow from another change.
- **Versions and notes stay with the record.** When something keeps versions (landing pages, templates), who made each version and an optional "what changed" note belong in the version's own history, shown in the editor; the log line points at the intent, without the note.
- **Test it**: the sentence for each event in a unit test (a name with `&` and `<`, no typed text), the entry an action writes in that action's test, and the trigger and the feed in pgTAP; then run the action once and read the feed.
- **Not yet enforced by a test**: that every `audit_row_change('<entity>', ...)` in the migrations has a label or sentence, and that every action file that mutates data writes an entry. Until a guard exists (`docs/TODO.md`, "A guard test for the Activity Log"), check by hand when you review a PR.


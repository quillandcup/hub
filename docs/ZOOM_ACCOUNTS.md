# Zoom Accounts: more than one account, and which meetings are kept

Quill & Cup hosts prickles and events on a primary Zoom account. A staff member also has a personal Zoom account whose link is sometimes used for a Quill & Cup session when the main link is occupied. The Hub imports meetings from more than one account, but most meetings on a secondary account are not community business, so they stay out of the Silver layer until an admin keeps them.

## The model

- **`zoom_accounts`** (id prefix `zacc_`, Tier 2, admin only): one row per account. `slug`, `label`, `host_email` (informational), `default_policy` and `credentials_prefix`. The migration seeds the **primary** account (`primary`, policy `keep`, prefix `ZOOM`) with a fixed id, which is also the default of the Bronze `zoom_account` columns: a row written by code that doesn't know the column is the primary account's.
- **`default_policy`**: `keep` (every meeting is kept unless an admin ignores it: today's behavior) or `exclude` (every meeting is left out until an admin keeps it).
- **`zoom_meeting_decisions`** (prefix `zmdc_`, admin only, audited): an admin's decision about a meeting. `scope = instance` is keyed by the meeting's uuid (one occurrence), `scope = series` by Zoom's meeting id (every past and future occurrence of a link). `decision` is `kept` or `ignored`. No row means the account default.
- **Resolution** (`lib/zoom-accounts.ts`, `meetingState` / `isMeetingKept`): the instance decision wins, then the series decision, then the account default. An account the Hub doesn't know is excluded. The same function serves the repository, the twin and the review page, so there is one rule.
- **Bronze keeps everything.** `bronze.zoom_meetings`, `zoom_attendees`, `zoom_participant_events` and `zoom_chat_messages` carry `zoom_account`. Exclusion is applied on read, in `ZoomRepository`: every attendee, live-presence, chat and imported-host read returns only kept meetings, so the attendance run, the unmatched-name and name-matching pages, the live room and the check-out DMs never see an unkept meeting. Nothing from an unkept meeting reaches members (no prickle, attendance, member match, check-in or check-out DM, reminder or calendar feed item). `attendeeCount()` and `latestMeetingStart()` stay raw (they describe Bronze).

## Processing and reprocessing

Silver stays fully reprocessable. `/api/process/attendance` reads whole meetings through `loadWholeMeetings` (the repository's filtered read) and then deletes and rebuilds the attendance and Pop-Up Prickles of the range with `reprocess_prickle_attendance_atomic`, which already removes prickles whose meeting is no longer in the data. So:

- an unkept meeting makes no prickle and no attendance;
- keeping it and reprocessing creates them (the prickle id is stable, keyed by the meeting uuid and times);
- ignoring a kept meeting and reprocessing removes them again.

The review page's action (`decideZoomMeetings`) writes the decision and then reprocesses attendance for the stretch of time the covered meetings span (a link's decision spans all its imported occurrences). If that run fails the decision is still saved and the page says to run attendance processing for those dates. Tests: `tests/api/reprocessability/zoom-account-decisions.test.ts` (database), `tests/lib/zoom-meeting-exclusion.test.ts`.

## Imports and webhooks cover every account

- **Import** (`/api/import/zoom`, called by the nightly `/api/reconcile/zoom`, the manual admin import and the webhook): imports every account in `zoom_accounts`, the primary first, tagging each row with its account. An account whose credentials are not all set is **skipped with a logged warning** and listed in the response (`accounts[].skipped`); a failing secondary account never fails the primary import. Only a missing primary credential fails, as before. A webhook asks for just its own account (`account` slug).
- **Credentials** are secret env vars named from the account's prefix: `<prefix>_ACCOUNT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_USER_EMAIL`, `_WEBHOOK_SECRET_TOKEN`. The primary account's (`ZOOM_*`) are unchanged; the secondary account's are `ZOOM_SECONDARY_*`, declared in `env-vars.config.ts`.
- **Webhook** (`/api/webhooks/zoom`): each Zoom app has its own secret token, so the signature is checked against every configured account's secret; the first match names the account, which is recorded on the participant events and chat messages and used for the import it triggers. An unsigned request, or one signed with an unknown secret, is refused. If the accounts can't be read, only the primary secret is accepted.

## Review page

Admin → Health Check → **Zoom Meetings** (`/admin/hygiene/zoom-meetings`): meetings of accounts whose default is `exclude`, filterable by account, state (undecided, kept, ignored), date and a search over topic and meeting id. Select rows and **Keep**, **Ignore** or **Back to default** (instance decisions), or **Keep / Ignore every occurrence of these links** (series decisions). The Health Check page shows how many meetings are undecided. Decisions are audited (`zoom_meeting_decision`) and recorded as the outcome `zoom_meetings_decided`.

## Setting up a second account (owner steps)

1. In the second Zoom account, create a **Server-to-Server OAuth** app with the same report and meeting read scopes as the primary app, and subscribe it to the same meeting webhook events as the primary app (meeting started/ended, participant joined/left, in-meeting chat), pointing at `/api/webhooks/zoom`.
2. Put its values in `.env.prod` (or `.env.shared`): `ZOOM_SECONDARY_ACCOUNT_ID`, `ZOOM_SECONDARY_CLIENT_ID`, `ZOOM_SECONDARY_CLIENT_SECRET`, `ZOOM_SECONDARY_USER_EMAIL` and the app's `ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN`, then `pnpm env:sync --only=ZOOM_SECONDARY_ACCOUNT_ID,ZOOM_SECONDARY_CLIENT_ID,ZOOM_SECONDARY_CLIENT_SECRET,ZOOM_SECONDARY_USER_EMAIL,ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN`.
3. Register the account (there is no screen for it yet; see `docs/TODO.md`), as a one-off statement run by the owner:

   ```sql
   insert into public.zoom_accounts (slug, label, host_email, default_policy, credentials_prefix)
   values ('secondary', 'Staff personal account', 'person@example.com', 'exclude', 'ZOOM_SECONDARY');
   ```

   Until this row exists nothing is imported for the account, and until its credentials are synced the import skips it.

# Kajabi API integration

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

The Kajabi API is the only source of Kajabi data for the Hub. Members, purchases, offers and course structure are read from it; nothing is uploaded from Kajabi exports (the old CSV import is unused: `docs/TODO.md`, "Remove the unused Kajabi CSV import").

## What it is used for

- **Reading (Bronze).** The sync fetches contacts, customers, purchases and offers, and writes them unmodified to `bronze.kajabi_contacts`, `kajabi_customers`, `kajabi_purchases` and `kajabi_offers` (upserted on the Kajabi id, so a re-run is idempotent). Silver `members` is rebuilt from them (`/api/process/members`), so it can always be reprocessed from Bronze plus Local data. Course structure (courses, modules, lessons, offers) is imported the same way (`lib/courses/import.ts`, `docs/product/COURSES.md`).
- **Writing back.** Small, targeted writes go to Kajabi from the app: a member's changed name, email or Instagram handle on their contact (`updateContact`), the landing page opt-in form submission (`submitForm`, `lib/landing/opt-in-kajabi.ts`), and an admin deleting an empty duplicate contact. After a write, one contact is re-fetched into Bronze (`lib/kajabi/contact-refresh.ts`).
- **Not in the API.** Lesson content, per-student lesson progress and comments are not in Kajabi's public API; they are captured from the admin with a local script (`pnpm courses:content`, see `docs/product/COURSES.md`). Kajabi webhooks are not used.

## How access is set up

The client (`lib/kajabi/client.ts`, `createKajabiClient`) authenticates with the OAuth client-credentials flow against `https://api.kajabi.com` and caches the token until shortly before it expires. It needs three variables, declared in `config/env-vars.ts` (group "Kajabi"):

| Variable | What |
|---|---|
| `KAJABI_CLIENT_ID` | The Kajabi API client ID |
| `KAJABI_CLIENT_SECRET` | The matching secret (a secret: never paste it anywhere) |
| `KAJABI_SITE_ID` | The site identifier, the number in the Kajabi admin URL after `/admin/sites/` |

There is one Kajabi account, so the values live in `.env.shared` and go to Vercel with `pnpm env:sync` (`docs/infrastructure/ENV_MANAGEMENT.md`; `.env.example` has the template). The client throws a clear error when a variable is missing. Create the API client in the Kajabi admin under Settings, Public API (`app.kajabi.com/admin/settings/public_api`); the API reference is at https://help.kajabi.com/api-reference/introduction, and the OpenAPI spec the code was written against is `lib/kajabi/openapi.yaml`. To rotate the secret, see `docs/runbooks/SECRET_ROTATION.md`.

## How it is synced

- **Nightly.** The Vercel cron in `vercel.json` calls `/api/reconcile/members` at 3:00 AM UTC; it runs the same sync as below and pings its Checkly heartbeat when it succeeds (`lib/cron-heartbeats.ts`). `app/api/reconcile/README.md` describes the reconcile jobs together.
- **By hand.** An admin runs the Kajabi API import from `/admin/data/import` (`KajabiApiImportForm`, `POST /api/import/kajabi`, admin only). The route fetches the four resources in parallel, writes Bronze, triggers member processing, and then syncs the courses; a courses problem is reported in the result but never fails the member sync.
- **Courses alone.** `POST /api/import/kajabi-courses` (optionally `{ "courseIds": [...] }`) imports course structure without the member sync.

Every response lists what was fetched and written. Kajabi's calls go through `outboundFetch` (`docs/infrastructure/OUTBOUND_REQUESTS.md`).

## Checking that it works

1. Run the import from `/admin/data/import` and read the counts in the result: contacts, customers, purchases and offers should match what Kajabi shows.
2. For the nightly job, look at the `reconcile-members` heartbeat in Checkly, or the `[Reconciliation]` lines in the Vercel logs (`.claude/rules/read-only-clis.md`).
3. An authentication failure surfaces as "Kajabi OAuth" errors in the response and logs: check the three variables above in the environment that failed.

## The old CSV path

`/api/import/members` and `/api/import/subscriptions` (with their admin forms on the dev-only testing page) accepted Kajabi CSV exports. They are unused and written for tables the app no longer reads (`bronze.kajabi_members`, `subscription_history`); do not use them. Their removal is tracked in `docs/TODO.md`.

---
paths:
  - "lib/analytics/**"
  - "app/actions/**"
  - "app/**/actions.ts"
  - "tests/lib/outcome-coverage.test.ts"
---

### Usage Analytics

**RULE**: A feature that ships needs events that show whether it is used. Declare them in the tracking plan (`lib/analytics/events.ts`) and call `track("object_action", { ... })` from `lib/analytics/client.ts`; never write to `analytics_events` directly, send to a provider, or add a property that could hold a person's name, email or typed text. Only declared events and properties are stored. Clicks are autocaptured; put `data-track="name"` on important controls and `data-track-ignore` on anything that shouldn't be recorded. Funnels for admins go in `lib/analytics/funnels.ts` (`/admin/analytics`). A server action whose result matters (something saved, created, sent) is wrapped with `withAction` so its outcome is recorded (`lib/analytics/actions.ts`, `lib/analytics/server.ts`); `tests/lib/outcome-coverage.test.ts` fails on an exported action that is neither wrapped, a read (`get`/`load`/`suggest`/`search`/`list`/`find`/`fetch`/`preview`), nor listed in its `NOT_TRACKED` with the reason. Notifications are tagged with their kind and channel by `createNotifier`: never build a notification link that bypasses it. A member can leave usage statistics from `/privacy`: any new code that records events for a member must honor it (`lib/analytics/opt-out.ts`). Details, consent and privacy rules: `docs/product/ANALYTICS.md`.

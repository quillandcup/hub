# Usage analytics

How the Hub finds out whether a feature earns its place: a log of what members do, and funnels over it.
Page-level analytics (Google Analytics, Vercel) stay as they are; this is the product-event stream beside them.

## Pieces

| Piece | Where |
|---|---|
| Tracking plan (the only events and properties that can be stored) | `lib/analytics/events.ts` |
| Browser queue: `track(name, props)`, batching, sessions | `lib/analytics/client.ts` |
| Click autocapture | `lib/analytics/autocapture.ts` |
| Consent rule | `lib/analytics/consent.ts` |
| Route templating (`/members/42` -> `/members/[id]`) | `lib/analytics/route.ts` |
| Receiver (validates against the plan) | `app/api/track/events`, `lib/analytics/receive.ts` |
| Storage, funnel and summary SQL | `analytics_events`, `analytics_funnel()`, `analytics_event_summary()` |
| Funnels shown to admins | `lib/analytics/funnels.ts` -> `/admin/analytics` |
| Explorer: ad-hoc funnels and breakdowns | `/admin/analytics/explore`, `lib/analytics/explore.ts`, `analytics_property_breakdown()` |

`app/api/track/page-view` is separate and unchanged: it feeds the access log and its page trail (`access_events`). The new stream records `page_viewed` too, so page views and feature events share sessions.

## Adding an event

1. Declare it in `EVENTS` (`lib/analytics/events.ts`): `object_action` name, snake_case properties. Prefer booleans, counts and enums; use `text` only for labels the UI itself defines, never for anything a person typed or a name.
2. Call `track("name", { ... })` where it happens (client components). `track` is typed from the plan.
3. To see it as a funnel, add it to `FUNNELS` (`lib/analytics/funnels.ts`) for a permanent, reviewed view. `where` filters a step on property values. For one-off questions, use the explorer instead: nothing to add.

No migration is needed. Before shipping a feature, write down what use would make it worth keeping and when you will look.

## Exploring without code

`/admin/analytics/explore` builds its pickers from the tracking plan (`describeEvents()`), so a new event and its properties show up there with no page changes. Choose the funnel's events in order, filter each step by its declared properties (booleans and enums offer their values), or pick an event and count it by the values of one property. The question lives in the URL (`lib/analytics/explore.ts`), so a view can be bookmarked or shared; a hand-edited URL is re-checked against the plan and anything it doesn't allow is ignored. Permanent funnels still go in `funnels.ts`.

## Identity and sessions

Events are for signed-in members and carry `user_id` (the auth user ID, as in `access_events`). There is no anonymous ID and no cookie of our own. `session_id` is a random UUID kept in `sessionStorage`; it rotates after 30 idle minutes and groups one visit. Retried batches are safe: `(user_id, message_id)` is unique and the receiver skips duplicates.

Events sent while an admin views as a member (sudo) are stored with `sudo = true` and left out of every usage number.

## Privacy

- **Allowlist.** The receiver drops unknown events and undeclared properties; nothing else reaches the table.
- **Autocapture** keeps the element kind, its `data-track` name or `id`, the route template, an internal link's target route, and a *button's* label (40 characters). Link text is not kept (often a name). Text typed into fields is never read. Put `data-track-ignore` on an element or ancestor to skip it.
- **Routes are templates**, never real paths or query strings.
- **Consent.** Where Google Analytics needs consent (EU/EEA/UK, or location unknown), events wait for the same Accept as GA; Decline stops them. Elsewhere they are on. Outside production they are always on (there is no banner). This is stricter than needed for signed-in first-party logging, on purpose: the banner says what it covers and Decline has to mean something. If you ever record without consent, that is a legal decision, not a code one.
- **Erasure.** `user_id` is `ON DELETE CASCADE`; deleting an account deletes its events. There is no soft delete: this is append-only telemetry with no history worth keeping once its person is gone.
- Admins read all events (RLS); members read only their own. The members-read-own policy is also required for the receiver's idempotent insert (Postgres applies the SELECT policy to `ON CONFLICT` writes).

## Experiments with few members

Feature flags and segments (`lib/features.server.ts`, `/admin/segments`) already decide who sees what. With a few hundred members, only large effects are detectable, so: test big changes, compare each member to themselves (a week on, a week off), write the decision rule down before looking, and read individual sessions as well as counts. Logging a `flag_exposed` event when a flag changes what someone sees is the natural next step.

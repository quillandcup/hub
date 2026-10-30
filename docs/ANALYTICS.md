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

`/admin/analytics` also ranks the most-clicked things: each control named by its `data-track` name, else its label, else where a link goes, with an optional page prefix and the admin area hidden by default so staff browsing doesn't drown out members. In the explorer a breakdown has its own filters (the funnel's don't apply to it), and free-form filter boxes suggest the values that really occur (last 90 days).

## Search

Search is measured with a few typed events plus named controls (`lib/analytics/search.ts`, `components/search/`). **The query text is never recorded**: a query can hold a name, an email or a phrase from a message. What is recorded is its *shape*: the `in:` scope (a fixed list), which operators it used (by name only: `from:fern` is just "from"), and how many words it had.

| Event | Fires | Answers |
|---|---|---|
| `search_opened` | the palette opens (`button`, `shortcut_k`, `shortcut_slash`) | how people reach search |
| `search_ran` | a search's results were shown (palette: once typing settles or the member acts, not per keystroke; results page and chat search page: on render) | how often each surface is used, how often chat is searched (`chat_searched`), zero-result rate (`results`), which scopes and operators are used |
| `search_result_clicked` | a result was opened, with its `kind` (chat, members...), `rank`, and `via` click or Enter | how often chat messages (or any kind) are clicked, and how far down |
| `search_suggestion_clicked` | something on the empty palette was opened: needs attention, a recent place, or a recent search | whether those sections earn their place |
| `search_filter_used` | a palette filter changed (kind, quick chip, From..., time range, a + option, a date, an autocomplete choice) | which filters get used |

`surface` is `palette`, `page` (the full results page, also `/admin/search`) or `chat_page`. Every palette button is also a named control (`search-filters-toggle`, `search-history-toggle`, `search-recent-item`, `search-attention-item`, `search-place-item`, `search-show-more`, `search-view-all`...), so the Least-clicked table shows click-through per button, counted when the palette opens. In the Explore page, break `search_ran` down by `kind`, `chat_searched` or `surface`.

Pages that report as they render use `trackWhenEnabled` (`lib/analytics/client.ts`): on a first page load the report can run a moment before consent has been read, so it waits for tracking to be switched on, and is dropped (never held) if it isn't.

## What analytics is not for

Operational records stay in their own tables. The Wheel of Wonder's connections (`wheel_of_wonder_matches`) are the source of truth for who was matched and whether a Slack reply confirmed it: they drive the spin's matching, the count shown to members, and are written server-side from Slack webhooks. Usage events are consent-gated, lossy (a declined banner, a blocked script, a closed tab) and deliberately hold no other member's id, so they can show the *funnel around* a feature (spun, revealed, joined) but not replace its record.

## Outcomes: did it work?

A click on "Save" says someone tried. `action_completed` says whether it worked: the server records `{ action, ok }` when a server action finishes (`lib/analytics/server.ts`).

- **Wiring an action.** Add its id to `OUTCOME_ACTIONS` (`lib/analytics/actions.ts`), rename the action to `fooImpl`, and export a wrapper at the bottom of the file: `export async function foo(...args: Parameters<typeof fooImpl>): ReturnType<typeof fooImpl> { return withAction("foo_done", () => fooImpl(...args)); }`. Actions that delegate to each other call the `Impl`, so only the one the member invoked is recorded. `tests/lib/outcome-wiring.test.ts` fails if an id is unused, or an action reports the wrong one.
- **What counts as success.** A result with `error`, `success: false` or `ok: false` is a failure; so is a throw (a thrown redirect is not). `withAction` takes a third argument for an action that needs its own rule (the wheel reports "nobody" as a success with a detail).
- **Consent.** The browser sets a first-party cookie, `hub_sid`, holding the visit's random session id, only while usage tracking is allowed, and clears it when tracking stops (`lib/analytics/session-cookie.ts`, `lib/analytics/client.ts`). The server records an outcome only when that cookie is present, so nothing is recorded for a visitor who declined, and the outcome carries the visit's id so it joins the clicks that led to it (a funnel can go click, then success).
- **Never in the way.** Recording swallows every error, and the action's own result or error always comes back unchanged.
- The `Actions: did they work?` table on `/admin/analytics` shows attempts, successes and failures per action, and flags the ones that fail often. In the Explore page, `action_completed` breaks down by `action` and `ok`.

## Notifications: sent and opened

- **Sent** (`notification_sent`, `source = 'system'`): recorded by `createNotifier` for each channel a notification actually reached, against the member's user, with no visit (`session_id` is null, so it never counts as a visit). Sends the member asked for (an admin's "send me a test") aren't recorded.
- **Opened** (`notification_opened`): in-app notifications record the click in the Hub (bell, banner, inbox). For Slack, email and push, every Hub link in the message is tagged `?nk=<kind>&nc=<channel>` (`lib/notifications/attribution.ts`, including links inside a feature's own Slack blocks); when the member lands, `AnalyticsEvents` records which notification it was, once, and strips the tag from the address. The unsubscribe links, API routes and the notification settings page are never tagged.
- The `Notifications: sent and opened` table shows each kind and channel's sends, opens and open rate. Opens are counted in the same window as sends, so read short windows with care.
- Events carry `source`: `client` (the browser), `server` (an outcome, in a visit), `system` (the app on its own). The browser's batch endpoint refuses `server` and `system` events (`SERVER_ONLY_EVENTS`), so a member can't forge them.

## Course viewing data is not analytics events

What the lesson player records (`video_watch_segments`: the playhead for resume, each stretch watched, a "viewed" marker per player session with the browser's user agent) is stored as **first-party course data**, in its own tables, written by `/api/courses/watch`. It does **not** go through the consent-gated event pipeline above, so it is not lost when a member in the EU, EEA or UK hasn't accepted the banner, and a member's views are attributed to them by name for staff (`/admin/courses/<id>/stats`). That was a deliberate choice (2026-10-20): the membership is paid, signed in, and about 90% US, and the course stats are core to running the course.

Known risk, so the choice stays visible: the EDPB's reading (Guidelines 2/2023, section 2.5) is that JavaScript which makes the browser send information to the site's own server is "gaining access" to the device under the ePrivacy Directive, which needs consent unless an exemption applies. Resume position and completion are the most defensible as strictly necessary for the course the member asked for. Feeding staff statistics from the same data is a weaker fit for EU, EEA and UK members. The UK has had a statistical-purposes exemption (with notice and an easy objection) since 5 February 2026, and the EU's Digital Omnibus proposes one for aggregated audience measurement, but that is a proposal. Mitigations in place: nothing is shared with a third party, only staff can read it, it is erased with the member (`ON DELETE CASCADE`), and the member-facing `/privacy` page (on for every member since 2026-10-30) now says how course videos are watched and recorded. Revisit with counsel if EU/UK membership grows. This is not legal advice.

Where a visit came from is **not** stored with the video data: the general access log (`access_events`) records each request's raw IP and the place it appears to be (`country`, `region`, `city`, from Vercel's `x-vercel-ip-*` headers; `lib/request-location.ts`), written by the proxy and the page-view tracker for every member and read by admins only, and anything that happened at a time (a video view) looks its place up as the member's latest located event before it (`access_locations_at()`, service role only). Also first-party, not consent-gated, and also on the `/privacy` page ("Where you connect from").

## Who the numbers count

Both usage pages have two filters (`lib/analytics/audience.ts`, `components/admin/AudienceFilter.tsx`), kept in the address (`staff=hide`, `sudo=show`) so a view can be shared:

- **Ignore staff** (off by default): leave out events from staff, meaning admins (`user_profiles.role = 'admin'`) and members with a `staff_role`. Turn it on once real members use the Hub, so staff testing doesn't read as usage.
- **Ignore staff in sudo** (on by default): leave out events recorded while an admin viewed as a member. Those are the viewed member's experience driven by staff, so "ignore staff" does not remove them; this filter alone decides whether they count, which keeps the two independent.

Every analytics function takes `ignore_staff` and `ignore_sudo` (defaults: false and true, so a caller that passes neither behaves as before) and applies them through `analytics_counts()` / `analytics_is_staff()`.

## Naming controls, and click-through

Every control worth asking "is this used?" about gets `data-track="feature-control"` (lower-case kebab-case, see `lib/analytics/names.ts`; `tests/lib/track-names.test.ts` checks every literal name). Name the main controls of a feature when it ships. The name does three jobs: it identifies a click when the label is left out, it is counted when the control scrolls into view (`element_seen`, once per visit, `lib/analytics/impressions.ts`), and it is the key for click-through.

`/admin/analytics` -> **Least-clicked controls**: for each named control, the share of visits that saw it and also clicked it, lowest first (`analytics_control_rates()`). A control nobody clicks still appears, because seeing it is the denominator. Controls seen by fewer than N visits (default 10), or first seen less than N days ago (default 14), are held back with a count, so a rate only appears when it means something. With a small membership expect the table to be mostly empty at first.

A control inside a popover or menu is seen when it opens, so its rate answers "of those who opened it, how many used this". Impressions record the name and page only, never a label.

## Identity and sessions

Events are for signed-in members and carry `user_id` (the auth user ID, as in `access_events`). There is no anonymous ID and no cookie of our own. `session_id` is a random UUID kept in `sessionStorage`; it rotates after 30 idle minutes and groups one visit. Retried batches are safe: `(user_id, message_id)` is unique and the receiver skips duplicates.

Events sent while an admin views as a member (sudo) are stored with `sudo = true` and left out of every usage number.

## Privacy

- **Allowlist.** The receiver drops unknown events and undeclared properties; nothing else reaches the table.
- **Autocapture** keeps the element kind, its `data-track` name or `id`, a label (40 characters), the route template, and an internal link's target route. The label is the control's `aria-label`, else a field's `<label>` or `name` (never its value or options, which are what someone typed or picked), else its own text. A label is a guess at "text the UI defines", and a control that shows a person's name or email would leak it, so it is **left out** when: the link goes to a record page (`/members/[id]`...); the page is in the admin area; the control is inside a `<table>` or anything marked `data-track-no-text`; or it looks like an email. Put `data-track-no-text` on any control that shows who is signed in or other people (the user menu has it), and give it a `data-track="name"` so it can still be found. `data-track-ignore` skips the click entirely.
- **If a label ever leaks**, fix the capture rule or mark the control, then run `SELECT analytics_scrub_labels()` as the database owner: it removes `text` from click events that look like an email, were on an admin page, were sent during sudo, or contain the clicking member's own name (the migration that added it ran it once).
- **Routes are templates**, never real paths or query strings.
- **Consent.** Where Google Analytics needs consent (EU/EEA/UK, or location unknown), events wait for the same Accept as GA; Decline stops them. Elsewhere they are on. Outside production they are always on (there is no banner). This is stricter than needed for signed-in first-party logging, on purpose: the banner says what it covers and Decline has to mean something. If you ever record without consent, that is a legal decision, not a code one.
- **Leave me out.** The switch on `/privacy` sets `user_profiles.analytics_opt_out_at` (`lib/analytics/opt-out.ts` is the one reader). While it is set the browser doesn't track, `/api/track/events` and the server-side recorders (`recordAction`, `recordSystemEvents`) store nothing for that account, and Google Analytics is denied; turning it on also deletes the account's stored events (`app/(member)/privacy/actions.ts`, service role). It beats any consent the banner stored. It is the account's own choice, so it is read-only while an admin views as a member. A new recorder that writes events for a member must check it.
- **Erasure.** `user_id` is `ON DELETE CASCADE`; deleting an account deletes its events. There is no soft delete: this is append-only telemetry with no history worth keeping once its person is gone.
- Admins read all events (RLS); members read only their own. The members-read-own policy is also required for the receiver's idempotent insert (Postgres applies the SELECT policy to `ON CONFLICT` writes).

## Experiments with few members

Feature flags and segments (`lib/features.server.ts`, `/admin/segments`) already decide who sees what. With a few hundred members, only large effects are detectable, so: test big changes, compare each member to themselves (a week on, a week off), write the decision rule down before looking, and read individual sessions as well as counts. Logging a `flag_exposed` event when a flag changes what someone sees is the natural next step.

# Events from the shared calendar

An event is a thing members can see in Events (a retreat, a workshop, a speaker session, a listed prickle). **Every event stands on exactly one prickle** (`community_events.prickle_id`, NOT NULL and unique) and has no schedule of its own: its title, description, location, host, guest speaker and times are the prickle's, read through the `community_event_details` view (`EventDetail` in `lib/data/events.ts`). The table is named `community_events` (renamed from `events`, which invites confusion with analytics and instrumentation events); the product noun stays "event" everywhere else: URLs, UI copy, the `EventDetail`/`EventRepository` types, `event_photos`, `event_attendees` and the `event_id` columns. The event row keeps only what the calendar and the prickle have no place for: audience, registration, capacity, photos, focus, agenda, results, cover image, event kind, and whether it is shown (`deleted_at`).

Two kinds of prickle carry an event:

- **A calendar prickle**: made by the calendar sync from a Google Calendar item (`prickles.calendar_event_id`). Its title, description, host, guest speaker and location are edited on the event page (or the prickle page, the same decision); its times come from Google Calendar.
- **A Hub prickle**: an event made in the Hub has no calendar item, so its schedule is a **Hub session** (`hub_sessions`: title, description, host, guest speaker, location, start and end), projected into a prickle (source `hub`, `prickles.hub_session_id`) of the "Event" type. `HubSessionRepository.create`/`update` write the session and project it, and return the prickle id. This is temporary: it goes away once events are written back to Google Calendar (`docs/TODO.md`, "Events and prickles: one schedule, later sub-events and write-back").

## How a calendar item becomes an event

A calendar item becomes an event in one of three ways. Either way the event stands on the item's prickle (an item that matched no prickle type gets a prickle of the "Event" type first, `elevateCalendarEvent`).

1. **Its prickle type is listed in Events.** On a prickle type (Admin → Data → Prickle Types), "Listed in Events" makes every upcoming calendar item of that type an event (Monthly Goal Review, Pitch Prickle, educational prickles...). Past sessions of a listed type are not backfilled: a recurring series would fill Past with every old session.
2. **It is tagged `#event`.** Add `#event` anywhere in the Google Calendar event's description. The next calendar sync makes the event, whatever the item is (a prickle of any type, or something that is no prickle at all, such as a retreat or a book launch), upcoming or past, so a past tagged item shows under Past. The tag is left out of the description members see (`stripEventTag`). `#events` and similar words don't count.
3. **An admin shows it by hand.** "Show in Events" on the item's admin prickle page (`/admin/prickles/<id>`, reached from the admin calendar, which can be paged into future weeks).

The admin calendar (`/admin/calendar`) marks prickles that have an event with a star (hover for whether it is in Events or was removed). Calendar items that are no prickle can't be opened from the calendar: tag them `#event` in Google Calendar.

## Automatic events follow their reason

Events made by rule 1 or 2 are **automatic** (`community_events.automatic`). On every calendar sync (`/api/process/calendar`) they are reconciled with the calendar, both ways:

- Taking `#event` out of the description, un-listing the prickle type, or deleting the calendar item **removes** the automatic event on the next sync. An event that has photos, an attendee list or a badge is kept (it has been worked on), and so is any event an admin has shown by hand or edited.
- **Editing an automatic event, or showing it by hand, keeps it**: it stops being automatic, and the sync no longer takes it away.

Events made in the Hub are never automatic.

## Where each field is edited

| Field | Calendar prickle | Event made in the Hub |
| --- | --- | --- |
| Title, description, host, guest speaker, location | The event page (`/admin/events/<slug>`, Edit) or the prickle page: both call `applyPrickleEdits` (`lib/prickle-edits.ts`) and write the calendar item's decision row, so a resync keeps it. | The event page; saved to its Hub session through `repos.hubSessions.update`. |
| Start and end | Read-only: they come from Google Calendar (no write path yet, `docs/TODO.md`, "Events and prickles"). | The event page. |
| Audience, registration, capacity, event kind, focus, agenda, results, cover, photos, Google Photos album, whether it is shown | The event page | The event page |

- **Dates and times are Eastern.** A Hub event is created with a start and end date and, optionally, clock times. Dates alone make an all-day event: Eastern midnight on the first day to Eastern midnight after the last day (`eventWindow` in `lib/event-window.ts`, using `ORG_TIMEZONE`). `EventDetail.starts_at`/`ends_at` are Eastern days derived from the prickle (an event ending exactly at midnight ends the day before).
- **Empty means follow the calendar** on a calendar prickle's title, description, guest speaker and location: emptying a field set by hand removes the decision and the calendar's text comes back.
- **A tidier title and location for members.** The calendar's title is written for prickles ("Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money with Sam"); members see "A Way to Make Money": the organization's label, the "[Category]" and a "Prickle:" label come off, and so does the host or guest after "w/" or "with" (`eventDisplayName`, `cleanEventTitle`). A guest speaker or host is not lost: it is stored apart from the title, and members see the name as the title and "with" its speakers, or else its host, on the Events page, the event page, search and calendar feeds. A new event starts with the "[Category]" as its focus. A location that is only a video call link shows as "Online (Zoom)" with a "Join on Zoom" link on the event page; the link and its meeting password are not printed.
- **Audience starts from the prickle type.** A new event made from a prickle takes its type's "Announced publicly" and "Guests allowed"; one made in the Hub starts members only. Change it on the event.
- **The admin address is the slug.** `/admin/events/<slug>` and `/events/<slug>` are the same event, so dropping or adding `/admin` switches between the admin and member view. An older link carrying the event's id (`/admin/events/evt_...`) redirects to the slug. The admin API routes (`/api/admin/events/<id>`) still take the internal id.

## The audience chain

Who may attend depends on how widely something is announced: **guests allowed** needs **announced publicly**, which needs **listed in Events** (for an event, being an event is the listing). The forms grey out each checkbox until the one before it is checked and uncheck what depended on it; the routes answer a violation with a message, and the database enforces it (`prickle_types_audience_chain`, `community_events_audience_chain`). Neither flag is read by a public page yet.

## Removing an event from Events

- **Tiers on the member Events page.** Events differ in how much they ask of a member, so the page highlights the upcoming ones that ask the most: **Special events** (retreats, workshops, parties, anything that takes a sign-up or an application: notice, if not always commitment) and **Educational** (its own pillar), as rectangular cards with the picture to one side. Below them is a month-at-a-glance list of everything, **sessions and the listed prickles that have no event yet included**: pills pick this month, next month or the one after (`?month=YYYY-MM`), days run down the page with the date on the left and a divider between weeks (`lib/events-agenda.ts`). Each line shows the time of day in the member's zone (from the prickle's times; nothing for an all-day event) and a place when it is not online (online is the default, so "Online (Zoom)" is not repeated). Titles drop the organization label and `[Category]` (`cleanEventTitle`). For the current month the counts and the list are what is still ahead (the note under the pills says so), and "See past events" leads to `/events/past`: past events a month at a time, back as far as there are any (a year pill, then the months of that year that have events; `?month=YYYY-MM`). An event that ran across months is listed in the one it began in. The past page lists the same things as the upcoming one: events, and the prickles of listed types (the weekly sessions) that have no event, which are not backfilled as events but are fetched a month at a time (`/api/events/past-prickles`, `fetchPastEventPrickles`), and ahead of time for the months either side of the open one and for a month someone points at. Every month from the first event's through this one is offered. The tier is derived (`eventTier` in `lib/events-filter.ts`) from the event's kind and its `registration`, not stored. An event made from a prickle starts as a session, or educational when it is the educational type's (`prickleEventKind`); an admin can change the kind on the event (a party or book launch is set that way, not by its type). A card without a photo shows a gradient and a symbol (`components/EventArt.tsx`): the icon of the badge the event awards when a badge is linked to it (a retreat), else one for its kind, until real images land.

"Remove from Events" on the event page sets `community_events.deleted_at`: members no longer see it in the Events page, the event page, search (admins still find it) or calendar feeds, and the prickle it stands for stays out of the Events list too. "Add back to Events" undoes it. It exists mainly so an event the calendar sync keeps making (one session of a listed type that you don't want featured) can be taken out without the next sync making it again; the hidden event stays and the sync leaves it alone.

## Not yet

Writing changes back to Google Calendar (the service account is read-only), default images and audience per prickle type, and matching an item to a prickle type from the Events side. See `docs/TODO.md`, "Managing events in the Hub".

## How a calendar title finds its prickle type

The sync (`matchTypeId` in `lib/calendar-events.ts`) tries, in order: the type part of the title ("Heads Down Prickle w/Cody" -> "Heads Down Prickle") against the types' names and aliases, then the **cleaned title** (the organization's label, the "[Category]" and "Prickle:" taken off) against the same, then a type whose name the title contains. So "Quill & Cup [Mindset] Prickle: Get Your Spark Back!" and "Quill & Cup: Get Your Spark Back Prickle with Ania" both find the type named "Get Your Spark Back Prickle". A title that matches no type waits in the unmatched queue (`/admin/hygiene/unmatched-events`), where an admin resolves it; give a type an alias (Admin → Prickle Types, "other names") for a wording that never matches by itself, such as "Quill & Cup Holiday Party (AM)!" for the "Q&C Holiday Party" type. The calendar import covers 90 days back and 90 days ahead, so older items need a manual import over a wider range before they can match.

## Editing a calendar prickle

On the admin prickle page (`/admin/prickles/<id>`) the **Edit** button turns the title, description, type, host, guest speaker and location into fields, with Save and Cancel; the date and time stay as text, since the calendar owns them. What you set is kept as the calendar event's decision row (`unmatched_calendar_events`: `resolved_type_id`, `resolved_host_id`, `resolved_title`, `resolved_description`, `resolved_guest_speaker`, `resolved_location`), because the sync rebuilds every calendar prickle from the calendar (Silver) and applies that Local decision on top, so edits survive reprocessing (`applyPrickleEdits` in `lib/prickle-edits.ts`, called by `updatePrickle` in `app/(admin)/admin/prickles/[id]/actions.ts` and by the event page's PATCH).

- Only what changed is saved: a form saved untouched sets nothing.
- **Empty means follow the calendar.** Emptying the title, description, guest speaker or location that had been set by hand removes the override and the calendar's text comes back (the days around the prickle are reprocessed straight away). A field marked "(edited)" is one that was set by hand.
- Changing the type reprocesses the days around the prickle too, since the title and the guest speaker are made from the calendar title with the type's rules.
- Pop-up prickles (from Zoom) have no calendar event to keep a decision on, so they aren't editable here.

## Editing an event

The admin event page (`/admin/events/<slug>`) is the one place to edit an event, whatever it stands on. **Edit** turns each value of the Details card into its field in the same place, with Save and Cancel (`EventDetailsCard`); **View prickle** is a secondary link to the prickle page.

- **An event made in the Hub:** every value is a field, the schedule included (dates, optional start and end time, host as free text, guest speakers, location, description), saved to its Hub session.
- **An event on a calendar prickle:** the title, description, host (a member picked with `MemberSearch`), guest speakers and location are fields. They are saved by `PATCH /api/admin/events/<id>` through `applyPrickleEdits`, the same function as the prickle page's Edit, so both write the calendar item's decision row (`unmatched_calendar_events`) and can never disagree. Only what changed is saved; a field set by hand is marked "(edited)" and **Follow the calendar again** empties it, which removes the override on Save (the days around the prickle are reprocessed straight away). The dates and times are read-only with a note that they come from Google Calendar, because nothing writes to Google yet.

Creating an event (Admin > Events > Add Event) makes a Hub session and the event on its prickle in one request (`POST /api/admin/events`); an event made from a calendar item goes through "Show in Events" on the admin prickle page (`elevateCalendarEvent`).

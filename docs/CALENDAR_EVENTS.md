# Events from the shared calendar

Events come from two places: the Hub (`events` rows an admin creates) and the shared Google calendar. A calendar item becomes an event in the Hub in one of three ways, and either way it is an `events` row linked to the calendar item by `events.calendar_event_id`.

## How a calendar item becomes an event

1. **Its prickle type is listed in Events.** On a prickle type (Admin → Data → Prickle Types), "Listed in Events" makes every upcoming calendar item of that type an event (Monthly Goal Review, Pitch Prickle, educational prickles...). Past sessions of a listed type are not backfilled: a recurring series would fill Past with every old session.
2. **It is tagged `#event`.** Add `#event` anywhere in the Google Calendar event's description. The next calendar sync makes the event, whatever the item is (a prickle of any type, or something that is no prickle at all, such as a retreat or a book launch), upcoming or past, so a past tagged item shows under Past. The tag is left out of the event's description. `#events` and similar words don't count.
3. **An admin shows it by hand.** "Show in Events" on the item's admin prickle page (`/admin/prickles/<id>`, reached from the admin calendar, which can be paged into future weeks).

The admin calendar (`/admin/calendar`) marks prickles that have an event with a star (hover for whether it is in Events or was removed). Calendar items that are no prickle can't be opened from the calendar: tag them `#event` in Google Calendar.

## Automatic events follow their reason

Events made by rule 1 or 2 are **automatic** (`events.automatic`). On every calendar sync (`/api/process/calendar`) they are reconciled with the calendar, both ways:

- Taking `#event` out of the description, un-listing the prickle type, or deleting the calendar item **removes** the automatic event on the next sync. An event that has photos, an attendee list or a badge is kept (it has been worked on), and so is any event an admin has shown by hand or edited.
- **Editing an automatic event, or showing it by hand, keeps it**: it stops being automatic, and the sync no longer takes it away.

Events made in the Hub are never automatic.

## What follows the calendar, and what is the Hub's

- **An event that stands for a prickle follows the prickle** (single source of truth): its title (the prickle's own, else its type's name), description, guest speaker and host come from the prickle, kept in step on every sync and straight after the prickle is edited (`prickleEventFields`, `syncCalendarEvent`). They are edited on the prickle (Admin prickle page, Edit); the event page shows them locked with a link. The event keeps only what the prickle has no place for: audience, registration, capacity, photos, focus, speakers for an event with no prickle, and its location (an override on the event, since a prickle has no location).
- **Follows the calendar:** the dates and times always. The title, description and location too, until an admin changes one; a changed field is recorded in `events.overridden_fields` and the sync leaves it alone.
- **Empty means follow the calendar.** Clearing a field on the event's edit form (or "Follow the calendar again" for all of them) removes its override and takes the calendar's current value.
- **The Hub's own:** everything Google Calendar has no place for: the audience fields (guests allowed, announced publicly, how people join, places, how places are given out), speakers, the photo gallery. An event keeps these however it was made.
- **A tidier title and location for members.** The calendar's title is written for prickles ("Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money with Sam"); the event's title is "A Way to Make Money": the organization's label ("Quill & Cup" or "Q&C" before a "[Category]" or colon), the "[Category]" and a "Prickle:" label come off, and so does the host or guest after "w/" or "with" (the last "with", so "Writing with Friends with Ana" keeps its title; a title that itself ends in "with Someone" loses that part: override it on the event). A guest speaker or host is not lost: it is stored apart from the title, and members see the event's name as the title and "with" its speakers, or else its host ("A Way to Make Money with Brayden Example", "Progress Prickle with Jenn P", `eventDisplayName`), on the Events page, the event page, search and calendar feeds. A new event starts with the "[Category]" as its focus and the prickle's guest speaker as its speakers. A location that is only a video call link shows as "Online (Zoom)" with a "Join on Zoom" link on the event page; the link and its meeting password are not printed.
- **Audience starts from the prickle type.** A new event made from a prickle takes its type's "Announced publicly" and "Guests allowed"; one made from an item that is no prickle starts members only. Change it on the event (e.g. to let guests into one educational session that takes sign-ups).

## The audience chain

Who may attend depends on how widely something is announced: **guests allowed** needs **announced publicly**, which needs **listed in Events** (for an event, being an event is the listing). The forms grey out each checkbox until the one before it is checked and uncheck what depended on it; the routes answer a violation with a message, and the database enforces it (`prickle_types_audience_chain`, `events_audience_chain`). Neither flag is read by a public page yet.

## Removing an event from Events

- **Tiers on the member Events page.** Events differ in how much they ask of a member, so the page highlights the upcoming ones that ask the most: **Special events** (retreats, workshops, parties, anything that takes a sign-up or an application: notice, if not always commitment) and **Educational** (its own pillar), as rectangular cards with the picture to one side. Below them is a month-at-a-glance list of everything, **sessions and the listed prickles that have no event yet included**: pills pick this month, next month or the one after (`?month=YYYY-MM`), days run down the page with the date on the left and a divider between weeks (`lib/events-agenda.ts`). Each line shows the time of day in the member's zone (from `events.start_time`/`end_time`, or the prickle's own times; nothing for an all-day or dates-only event) and a place when it is not online (online is the default, so "Online (Zoom)" is not repeated). Titles drop the organization label and `[Category]` (`cleanEventTitle`). For the current month the counts and the list are what is still ahead (the note under the pills says so), and "See past events" leads to `/events/past`: past events a month at a time, back as far as there are any (a year pill, then the months of that year that have events; `?month=YYYY-MM`). An event that ran across months is listed in the one it began in. Past events are events only; past sessions of a listed prickle type are not events (see `docs/TODO.md`). The tier is derived (`eventTier` in `lib/events-filter.ts`) from the event's kind and its `registration`, not stored. An event made from a prickle starts as a session, or educational when it is the educational type's (`prickleEventKind`); an admin can change the kind on the event (a party or book launch is set that way, not by its type). A card without a photo shows a gradient and a symbol (`components/EventArt.tsx`): the icon of the badge the event awards when a badge is linked to it (a retreat), else one for its kind, until real images land.

"Remove from Events" on the event page sets `events.deleted_at`: members no longer see it in the Events page, the event page, search (admins still find it) or calendar feeds, and the prickle it stands for stays out of the Events list too. "Add back to Events" undoes it. It exists mainly so an event the calendar sync keeps making (one session of a listed type that you don't want featured) can be taken out without the next sync making it again; a deleted calendar-linked event is made again.

## Not yet

Writing changes back to Google Calendar (the service account is read-only), default images and audience per prickle type, and matching an item to a prickle type from the Events side. See `docs/TODO.md`, "Managing events in the Hub".

## How a calendar title finds its prickle type

The sync (`matchTypeId` in `lib/calendar-events.ts`) tries, in order: the type part of the title ("Heads Down Prickle w/Cody" -> "Heads Down Prickle") against the types' names and aliases, then the **cleaned title** (the organization's label, the "[Category]" and "Prickle:" taken off) against the same, then a type whose name the title contains. So "Quill & Cup [Mindset] Prickle: Get Your Spark Back!" and "Quill & Cup: Get Your Spark Back Prickle with Ania" both find the type named "Get Your Spark Back Prickle". A title that matches no type waits in the unmatched queue (`/admin/hygiene/unmatched-events`), where an admin resolves it; give a type an alias (Admin → Prickle Types, "other names") for a wording that never matches by itself, such as "Quill & Cup Holiday Party (AM)!" for the "Q&C Holiday Party" type. The calendar import covers 90 days back and 90 days ahead, so older items need a manual import over a wider range before they can match.

## Editing a calendar prickle

On the admin prickle page (`/admin/prickles/<id>`) the **Edit** button turns the title, description, type, host and guest speaker into fields, with Save and Cancel; the date and time stay as text, since the calendar owns them. What you set is kept as the calendar event's decision row (`unmatched_calendar_events`: `resolved_type_id`, `resolved_host_id`, `resolved_title`, `resolved_description`, `resolved_guest_speaker`), because the sync rebuilds every calendar prickle from the calendar (Silver) and applies that Local decision on top, so edits survive reprocessing (`updatePrickle` in `app/(admin)/admin/prickles/[id]/actions.ts`).

- Only what changed is saved: a form saved untouched sets nothing.
- **Empty means follow the calendar.** Emptying the title, description or guest speaker that had been set by hand removes the override and the calendar's text comes back (the days around the prickle are reprocessed straight away). A field marked "(edited)" is one that was set by hand.
- Changing the type reprocesses the days around the prickle too, since the title and the guest speaker are made from the calendar title with the type's rules.
- Pop-up prickles (from Zoom) have no calendar event to keep a decision on, so they aren't editable here.

## Editing an event

On the admin event page (`/admin/events/<id>`) **Edit** turns each value of the Details card into its field in the same place, with Save and Cancel (`EventDetailsCard`), including the ones that are empty. One notice at the top says what follows the calendar and, for an event that stands for a prickle, links to the prickle where its title, description, guest speaker and host are edited; those fields are locked here, and so are the dates of any event that follows the calendar. An event made in the Hub has every field editable and no notice.


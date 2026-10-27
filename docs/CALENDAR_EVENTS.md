# Events from the shared calendar

Events come from two places: the Hub (`events` rows an admin creates) and the shared Google calendar. A calendar item becomes an event in the Hub in one of three ways, and either way it is an `events` row linked to the calendar item by `events.calendar_event_id`.

## How a calendar item becomes an event

1. **Its prickle type is listed in Events.** On a prickle type (Admin → Data → Prickle Types), "Listed in Events" makes every upcoming calendar item of that type an event (Monthly Goal Review, Pitch Prickle, educational prickles...). Done by the calendar sync (`/api/process/calendar`, `ensureCalendarEvents` in `lib/calendar-events.ts`). Past items are not backfilled.
2. **It is tagged `#event`.** Add `#event` anywhere in the Google Calendar event's description. The next calendar sync makes the event, whatever the item is (a prickle of any type, or something that is no prickle at all, such as a retreat or a book launch). The tag is left out of the event's description. `#events` and similar words don't count.
3. **An admin shows it by hand.** "Show in Events" on the item's admin prickle page (`/admin/prickles/<id>`, reached from the admin calendar; weeks ahead can be browsed too), or on the list at `/admin/events/calendar`, which also lists items that are no prickle.

The admin calendar (`/admin/calendar`) marks prickles that have an event with a star (hover for whether it is shown or hidden).

## What follows the calendar, and what is the Hub's

- **Follows the calendar:** the dates and times always. The title, description and location too, until an admin changes one; a changed field is recorded in `events.overridden_fields` and the sync leaves it alone. "Follow the calendar again" on the event page clears the overrides.
- **The Hub's own:** everything Google Calendar has no place for: the audience fields (guests allowed, announced publicly, how people join, places, how places are given out), speakers, the photo gallery. An event keeps these however it was made.

## Hiding

"Hide from members" on the event page sets `events.deleted_at`. A hidden event is left out of the member Events page, the event page, search (admins still find it) and calendar feeds, the calendar sync leaves it hidden, and the prickle it stands for stays out of the Events list too. Hide it rather than deleting it: a deleted calendar-linked event is made again by the next sync.

Taking `#event` out of a description, or un-listing a prickle type, doesn't remove events already made: hide them.

## Not yet

Writing changes back to Google Calendar (the service account is read-only), default images and audience per prickle type, and matching an item to a prickle type from the calendar list. See `docs/TODO.md`, "Managing events in the Hub".

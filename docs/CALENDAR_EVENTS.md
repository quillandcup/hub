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

- **Follows the calendar:** the dates and times always. The title, description and location too, until an admin changes one; a changed field is recorded in `events.overridden_fields` and the sync leaves it alone.
- **Empty means follow the calendar.** Clearing a field on the event's edit form (or "Follow the calendar again" for all of them) removes its override and takes the calendar's current value.
- **The Hub's own:** everything Google Calendar has no place for: the audience fields (guests allowed, announced publicly, how people join, places, how places are given out), speakers, the photo gallery. An event keeps these however it was made.
- **A tidier title and location for members.** The calendar's title is written for prickles ("Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money with Sam"); the event's title is "A Way to Make Money": the organization's label ("Quill & Cup" or "Q&C" before a "[Category]" or colon), the "[Category]" and a "Prickle:" label come off, and so does the host or guest after "w/" or "with" (the last "with", so "Writing with Friends with Ana" keeps its title; a title that itself ends in "with Someone" loses that part: override it on the event). A new event starts with the "[Category]" as its focus and the prickle's guest speaker as its speakers. A location that is only a video call link shows as "Online (Zoom)" with a "Join on Zoom" link on the event page; the link and its meeting password are not printed.
- **Audience starts from the prickle type.** A new event made from a prickle takes its type's "Announced publicly" and "Guests allowed"; one made from an item that is no prickle starts members only. Change it on the event (e.g. to let guests into one educational session that takes sign-ups).

## The audience chain

Who may attend depends on how widely something is announced: **guests allowed** needs **announced publicly**, which needs **listed in Events** (for an event, being an event is the listing). The forms grey out each checkbox until the one before it is checked and uncheck what depended on it; the routes answer a violation with a message, and the database enforces it (`prickle_types_audience_chain`, `events_audience_chain`). Neither flag is read by a public page yet.

## Removing an event from Events

"Remove from Events" on the event page sets `events.deleted_at`: members no longer see it in the Events page, the event page, search (admins still find it) or calendar feeds, and the prickle it stands for stays out of the Events list too. "Add back to Events" undoes it. It exists mainly so an event the calendar sync keeps making (one session of a listed type that you don't want featured) can be taken out without the next sync making it again; a deleted calendar-linked event is made again.

## Not yet

Writing changes back to Google Calendar (the service account is read-only), default images and audience per prickle type, and matching an item to a prickle type from the Events side. See `docs/TODO.md`, "Managing events in the Hub".

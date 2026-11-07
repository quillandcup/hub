# Check-ins and Check-outs: When and Where They Appear

What the questions are, and why, is in `CHECKINS.md`. This is the other half: **when each
offer appears and disappears, on which surface, and for whom.** It is written from the code
(constants named below), so when you change a timing, change it here too.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **DM / message** | The check-in or check-out sent through the notifier (`createNotifier`, kinds `prickle_checkin` and `prickle_checkout`). It goes out on the channels the member keeps on: Slack, in-app (banner, bell, inbox), browser push, email. | `lib/prickle-checkin-dms.ts`, cron `app/api/internal/prickle-checkins/route.ts` (every 5 minutes) |
| **Dashboard row pills** | "Check in →" and "Check out →" on a prickle's row in Upcoming Prickles (Dashboard, My Prickles). | `components/UpcomingPrickleRow.tsx`, `lib/upcoming-prickles.ts` |
| **Search palette** | "Needs attention" lists check-ins on offer. | `app/actions/search.ts` |
| **"What did you write?" card** | Dashboard card for prickles that ended and are not yet checked out of, logged or dismissed. | `getUnloggedRecentPrickles` in `app/(member)/projects/actions.ts` |

Defaults: Slack, in-app and browser push are on for both kinds; **email is off** until a member
opts in per kind. A member who turned every channel off, or can be reached on none, is skipped
without a dedup row, so turning it back on before the window ends still sends one. Details of the
channel system: `docs/TODO.md`, "Channels, Notifications & Messaging", and `CLAUDE.md`, "Member
Notifications".

## Pop-Up Prickles are paused

Pop-Up Prickles (source `zoom`, created by the attendance processing from a Zoom room) get no
check-in or check-out for now, on any surface. `checkinsPausedFor` in `lib/prickle-checkins.ts` is
the one rule: the DMs (`app/api/internal/prickle-checkins/route.ts`) and the dashboard's "How did
it go?" card (`getUnloggedRecentPrickles`, `recentPresentPrickles`) ask it through `offersCheckins`
(which also limits them to writing prickles), and the dashboard pills and the search palette ask
it in `checkinOffered`. The pills and the palette do not limit themselves to writing prickles: a
prickle of a "work" type (Study Hall, Brainstorm, Pitch) with a personal tie still offers one,
which the DMs never send (`docs/TODO.md`, "Check-in pills show on work prickles; the DMs don't").
The reasons for the pause and the plan to bring Pop-Up Prickle check-ins back are in
`docs/TODO.md`, "Check-ins and check-outs for Pop-Up Prickles". Where the tables below say a
check-out is sent "from imported attendance as the backstop" or "within minutes" by presence,
that describes scheduled prickles.

## Who is "tied" to a prickle

The offers on the Dashboard and in search need a **tie** between the member and the prickle
(`checkinOffered`): hosting it, an active commitment, a calendar item added by hand, or being **in
its Zoom room** while it runs (`markPresent`, live presence from the participant webhooks in
`lib/zoom-presence.ts`).

The **check-in message** is sent ahead of time, so only the first three can count: it goes to
active members who have the prickle on their calendar feed (`planCheckinDMs`), whether or not
they have a writing goal. Being in the room is not known 15 minutes before the start, so a
member who just joins (a "drop-in") gets a second kind of check-in message
(`sendDropInCheckins`): once live presence shows them in the room of a writing prickle that
started less than `DROP_IN_CHECKIN_WINDOW_MS` (18 minutes, the end of the talking time) ago, they
are sent the same check-in through the same notifier, worded "You're in …" instead of "starts in
about 20 minutes". The dedup log keeps it to one per member and prickle, so a member who got the
usual one is not sent another. It is behind the `checkin_dropins` flag, switched on for everyone
since 2026-11-06 (migration `20270517000000_enable_checkin_dropins.sql`; it ran as a dry run for
everyone before, which logged about 18 a day), so a member who joins without a plan gets the
check-in and the check-out as a pair. The flag stays so an admin can turn it off from the feature
flags admin page if members push back on the volume. While it is off, or for a member it does not
cover (flag off, no segment, no preview), it is a dry run: it logs the member, prickle, channels and
why (`DRY RUN drop-in check-in` in the logs of `/api/internal/prickle-checkins`) and sends and
records nothing.

The **check-out message** does not use ties at all. It goes to anyone Zoom presence shows in the
room (`dueCheckoutMembers`), and as a backstop to anyone with imported attendance. A member
with no writing goal gets the same check-out without the progress questions, plus a one-line tip
to set a goal (`NO_GOAL_TIP`, linking to `/projects`). The tip is on a line of its own in the Slack
message, in the email under the explanation, and at the bottom of the web check-out; the in-app and
push text stay one line without it.

**Staying on from the previous prickle does not count as attending the next.** Everything that
works from live presence (the drop-in check-in, the check-out message, the "You're in the room" tie
and the "What did you write?" card) counts time in the room the way the attendance processing does
(`staysOf` and `countedPrickleIds` in `lib/zoom-presence.ts`, `EDGE_STAY_MS` = 15 minutes,
`docs/ATTENDANCE_RULES.md`): a stay of less than 15 minutes in a prickle does not count when the stay
in the neighbouring prickle was 15 minutes or more. A member who lingers a few minutes into the
next prickle therefore gets no check-out for it and is not marked present in it. For the drop-in
check-in the rule is stricter on purpose: a member who is carrying on from a 15-minute-plus stay in
another prickle never gets it, rather than getting it at minute 15 to 18, which is too late for
"how are you coming in". A fresh joiner gets it on the next cron tick and can dismiss it if they do
not stay.

Presence needs the Zoom participant's name or email to match a member (`matchAttendeeToMember`).
A participant who does not match gets none of the presence-based pieces and falls back to the
attendance import.

## Timing constants

| Constant | Value | Meaning |
|---|---|---|
| Check-in send window | 15–30 min before the start | `sendCheckins` in the cron route; the text says "~20 min" |
| `DROP_IN_CHECKIN_WINDOW_MS` | 18 minutes | A member who joins the room is sent the check-in if the prickle started less than this ago |
| `CHECKIN_SOON_MS` | 2 hours | The pill is offered from this long before the start |
| `CHECKOUT_BEFORE_END_MS` | 10 minutes | Members in the room are due the check-out this long before the end. The cron runs every 5 minutes, so it lands 10 to 5 minutes before. |
| `EARLY_LEAVE_GRACE_MS` | 10 minutes | An early leaver is due the check-out this long after leaving without rejoining (a bathroom break is not leaving) |
| `CHECKOUT_TIME_SENSITIVE_MS` | 3 hours | The check-out banner lasts this long after the end |
| `CHECKOUT_LOOKBACK_MS` | 6 hours | A check-out can still go out for a prickle that ended this recently; also how far the card looks for presence-based prickles |
| `IN_PROGRESS_LOOKBACK_MS` | 12 hours | Only a query bound for finding prickles that are running now |
| Card lookback | 14 days | Attendance-based entries on "What did you write?" |

## When the check-in appears and disappears

| Where | Appears | Disappears |
|---|---|---|
| Message on Slack (and email or browser push, if the member turned them on) | 15–30 minutes before the start, to active members with the prickle on their calendar, goal or not. A member who joins the room instead gets it then (see above). | Stays in Slack; its buttons keep working |
| In-app banner | When the message is sent | At the prickle's end, or sooner if answered, opened or dismissed |
| Bell and inbox | When the message is sent | Never removed; marked read when opened, dismissed or answered |
| Dashboard and My Prickles, "Check in →" | 2 hours before the start, with a tie (being in the room counts, so a drop-in sees it once their join arrives) | At the end; dismissing the offer hides it sooner; "Checked in ✓" once answered |
| Search palette, "Needs attention" | Same rule as the pill | Same as the pill, and once answered |

## When the check-out appears and disappears

| Where | Appears | Disappears |
|---|---|---|
| Message on Slack (and the other channels, as above) | 10 minutes before the scheduled end for members in the room (sent 10 to 5 minutes before); 10 minutes after leaving for an early leaver; or from imported attendance as the backstop, within 6 hours of the end | Stays in Slack |
| In-app banner | When the message is sent; lasts until 3 hours after the end | After that, or when answered or dismissed. A message sent later than that (the backstop) skips the banner and goes straight to the bell |
| Bell and inbox | When the message is sent | Never removed; marked read when answered or dismissed |
| Dashboard and My Prickles, "Check out →" | At the prickle's start, same row and tie rules as the check-in pill | At the end; "Checked out ✓" once answered |
| "What did you write?" card | Within minutes of the end if presence shows the member was in the room (up to 6 hours); otherwise when attendance is imported, which can take about 3 hours when one room runs prickles back to back (up to 14 days) | When progress is logged, the check-out is finished, or it is dismissed |

Both messages are deduplicated per member and prickle (`prickle_checkin_dm_log`). A message is not
sent when the questions are already answered, or the offer was dismissed.

## Scenario by channel

"Channels" means each channel the member has on: Slack, in-app, browser push, email.

| Scenario | Channels | Dashboard and search |
|---|---|---|
| Check-in, prickle on the calendar, with or without a goal | Sent 15–30 minutes before the start | Pill from 2 hours before the start until the end |
| Check-in, drop-in with no tie | When the Zoom join arrives, if the prickle started less than 18 minutes ago (live for members the `checkin_dropins` flag covers, a dry run for the rest) | Pill once the Zoom join arrives and the prickle has started |
| Check-out, in the room, with a goal | Sent 10 to 5 minutes before the end, with progress questions | "Check out →" from the start; card after the end |
| Check-out, in the room, no goal | Same send, no progress questions; Slack and email add the tip line | Same pill and card; the web check-out shows the tip too |
| Check-out, left early | Sent 10 minutes after leaving without rejoining | Same pill and card |
| Check-out, Zoom name not matched | Only after the attendance import, within 6 hours of the end | Card only, once attendance arrives |

## Overlap

The check-out message goes out 10 to 5 minutes before the end, while the check-in banner stays
until the end. A member who never answered the check-in therefore sees **both banners** for those
last minutes, and the same happens with back-to-back prickles. They stack as separate banners
(`MAX_BANNERS` = 3, then "+N more"); nothing displaces the other, and the bell and inbox keep both.
Merging them was judged not worth the complication: the links and questions differ. A possible
cheap tweak, not done: have the check-out send mark the same prickle's unanswered check-in as read.

## Checking it

Admin → Test Notifications (`/admin/notifications`) sends each kind to the admin's own accounts,
with the admin's own goals, so the tip only shows if the admin has none. Check it on a
phone: it should stay on one line.

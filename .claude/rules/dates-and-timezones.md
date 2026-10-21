## dates-and-timezones

Quill & Cup talks in Eastern time: prickles are announced, scheduled and counted by Eastern days. The server's own zone is not that (it is UTC on Vercel), so code that asks "what day is it" without naming a zone is wrong for several hours every evening and around midnight prickles. This has caused real bugs (a calendar defaulting to the wrong week, a timezone fix PR).

**Org-wide days, weeks and months use `ORG_TIMEZONE`** (`lib/config.ts`, from `app.config.ts`; currently America/New_York). That covers "today", the start and end of a day or week, the first of next month, a prickle's calendar date, streaks, reminder windows, and the date boundary for a midnight prickle.
- Don't use `getDay()`, `getDate()`, `setHours(0, 0, 0, 0)` or `new Date(y, m, d)` for these: they use the host's zone. Don't slice an ISO string (`toISOString().slice(0, 10)` is the UTC date).
- Name the zone every time you format or split a date: `Intl.DateTimeFormat(..., { timeZone: ORG_TIMEZONE })`, or the helpers other code already uses (see `lib/community-stats.ts`, `lib/prickle-schedules.ts`, `lib/member-reminders.ts`).
- Weeks start on Sunday; calendars default to the current week.

**What one member sees uses that member's zone.** It is `user_profiles.timezone_preference` (`getUserTimezonePreference()` in `lib/timezone.ts`). The value `"browser"` means "not detected yet" and is not a zone: check with `isValidTimeZone()` (`lib/time-zone.ts`), and fall back to `ORG_TIMEZONE`, as `lib/member-reminders.ts` does. Anything addressed to the whole community (a prickle's listed time, "Eastern") stays in `ORG_TIMEZONE`.

**Store instants, convert at the edges.** Database columns are `timestamptz` (UTC). Do the Eastern-day arithmetic in code or in SQL with `AT TIME ZONE`, naming the zone; never store a local wall-clock time without its zone.

**Tests**
- Pin "now" and test both sides of the boundary: 23:30 and 00:30 Eastern, and a day in each daylight saving change (the second Sunday of March, the first Sunday of November), where a day is 23 or 25 hours long. Use `lib/clock` with `useFakeClock()`, or `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime()` (see `CLAUDE.md`).
- Don't depend on the machine's zone: CI runs in UTC and a laptop in another zone. If a test passes only in your zone, it is wrong. Don't copy `tests/calendar-week-start.test.ts`, which reimplements the logic with local time.
- When you fix a timezone bug, the test that fails first is one at the boundary where it went wrong.

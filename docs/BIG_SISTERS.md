# Big Sister program

Every new member is matched with an existing member (their **big sister**) for **30 days**: someone who shows them around, answers the questions that are easier to ask a person, and invites them to prickles. "New member" means anyone whose membership just began, however:

- a **trial** (a Stripe subscription that shows one),
- a **direct sign-up** (a membership with no trial),
- someone **rejoining** after time away (they're new again), or
- someone joining through a **program that includes membership** (180 Program, Ready Writers...).

A program that doesn't include membership (Self-Editing Academy) doesn't get a big sister. Staff set that per program (`programs.includes_membership`, a checkbox on `/admin/programs`).

This replaces the old Google Sheet. Staff run it at `/admin/mentorship`; members see their own side (below).

## What staff do by hand, and what they don't

By hand: **pick a big sister for each new member** (with recommendations), and nothing else. Everything else comes from the data:

- **When it started and how they arrived** come from the sign-up, not a typed date (`lib/arrivals.ts`): a membership subscription created in Kajabi (a trial only if Stripe shows one, otherwise a direct sign-up) or the start of a cohort for someone enrolled in a program that includes membership. It only counts if they weren't a member the day before: a renewal, a plan change, a hiatus ending or a program joined while already a member isn't an arrival. Time away does make them new. This uses the same membership timeline as a member's status page (Kajabi stints, hiatuses, programs that include membership, gift/direct-Stripe overrides).
- **A trial's end** comes from the Stripe subscription's `trial_start` / `trial_end` in our imported Bronze data (no call to Stripe's API). A trial is never assumed: many offers have none (a returning member's link, a stretch when trials were off).
- **Whether a trial converted** is derived from membership history (below), never stored.
- **Why a trial didn't continue** is written by the **big sister**, who knows. Staff can edit it too.

## Data

`mentorships` is a **Local** table (see CLAUDE.md): one row per match, never reprocessed.

| Column | Meaning |
|---|---|
| `mentor_member_id`, `new_member_id` | Both are `members`. |
| `started_on` | The day their membership began. The 30 days run from here. |
| `kind` | `trial`, `direct` or `program`. |
| `trial_ends_on` | For a trial, from Stripe. |
| `status` | `matched` counts toward stats and the badge. `reassigned` is a match that fell through; kept for history, counts for nothing. |
| `outcome_note` | Why a trial didn't continue, written by the big sister. |

Rules:

- One active big sister **per arrival**: a partial unique index on `(new_member_id, started_on) WHERE status = 'matched'`. A member who rejoins later arrives again and gets a new match. To re-match the same arrival, mark the old row `reassigned` first.
- A big sister can have several new members over time. The program prefers **one at a time**, so the form warns when someone is already inside their 30 days; it doesn't block.
- RLS is admin-only: the table names new members and holds notes. Changes are audited (`mentorship`).

## Conversion (trials only)

A trial has an outcome; a direct sign-up or program arrival has nothing to convert (`no_trial`) and is left out of the rate. `lib/mentorship.ts` `deriveOutcome` reads the new member's `members.first_joined_at` / `most_recent_joined_at` (the first billed membership; a trial cancelled before billing never sets it) against `started_on`:

- **Converted**: a membership began between 7 days before the start and `CONVERSION_WINDOW_DAYS` (90) after. A returning member's old `first_joined_at` is ignored in favor of `most_recent_joined_at`. "Current member" is `members.status` of `active` or `on_hiatus` today.
- **In trial**: no such membership yet and the trial hasn't ended plus `BILLING_GRACE_DAYS` (3). So a 7-day trial is called about 10 days in, a month-long one about 33.
- **Did not convert**: no such membership and that point has passed.

Stats count only decided trials in the rate. Rows imported from the old sheet are `trial` with no stored end, so they use just the 3-day grace after the start.

## What the big sister sees and does

All member-facing reads go through `my_mentorships(member_id)` (SECURITY DEFINER; a member gets only their own matches, an admin any member's so sudo works). A match shows for exactly 30 days (`MENTORSHIP_DAYS`).

- **Dashboard card** (`components/member/BigSisterCards.tsx`): "Your Big Sister" for a new member, "Your new member(s)" for a big sister, with a Slack DM link (Hub chat can't start a DM yet; see `docs/TODO.md` "Big Sisters: message in the Hub") and a link to `/big-sisters`.
- **`/big-sisters`**: the same cards, how it works, and the volunteer card. **The Big Sister badge on a profile links here** (`badgeHref`), so anyone viewing a big sister's profile or the chat profile panel sees it.
- **The reason a trial didn't continue**: when a big sister's trial member hasn't become a member (outcome derived server-side; the page gets only "ask why", never their dates or status), the card shows a box: "*Name* didn't stay after their trial. What do you think happened?" It saves through `set_mentorship_note`, which lets only that match's big sister (or an admin) write that one column. It stays open until 60 days after the start (`NOTE_WINDOW_DAYS`), so a month-long trial's big sister can still answer. Read-only in sudo. A new member sees none of this.
- **Introduction** when staff make a match: a `big_sister_match` notification to both (Slack, in the Hub and browser push by default; email opt-in like every kind). Nothing is sent for a match whose 30 days are already up, and the import script never sends.
- **Getting Started step** "Say hi to your Big Sister", for a member with a current big sister, after "Join a prickle".

## Badge

`hedgie_mentor` (renamed **Big Sister**, 🧭) is automatic: its level is the number of `matched` rows whose start has passed, with tiers at 1, 2, 5, 10 and 25. Members can't read `mentorships`, so profiles get the count from `mentorship_counts()` (SECURITY DEFINER; mentor ids, counts and dates only). Awards made by hand before this existed still count: the larger of the two numbers wins (not the sum).

## Volunteer pool

Like hosts, members volunteer themselves: `big_sister_volunteers` (one row per member; `deleted_at` NULL = volunteering, so stepping off keeps history). A member does it on `/big-sisters` (optional note only staff see), read-only in sudo. **The same rule as hosting**: a full month since they first joined, enforced by reusing `getHostEligibility` (`lib/big-sister-volunteers.ts`). The pool isn't a public list: members read only their own row, admins read all.

Staff see it at `/admin/mentorship/volunteers` (add or remove anyone) and in the Matches form as one-click picks. `rankVolunteers` orders them by fewest new members inside their 30 days, then longest since their last match (never matched first, then earliest volunteer). Volunteering doesn't gate matching: staff can match any member, and nothing is matched automatically.

## Work Queue

A new member gets a **Needs a Big Sister** item in the admin Work Queue (`buildBigSisterQueue`) from the day they arrive until matched: everyone `getArrivals` finds in the last 14 days (all four kinds above). Matching them (same member and start date) makes the item disappear; **Mark Done** dismisses it without a match; **Assign** opens the Matches form with that member filled in. The Matches form also lists everyone waiting (up to 30 days back) as one-click picks. It needs Kajabi, and Stripe for trials, to have imported the sign-up, so an item can appear a little after it. The queue is behind the `work_queue` feature preview, like the rest of it.

## Importing the old spreadsheet

`scripts/import-mentorships.ts` reads a CSV (`mentor`, `trial`, `trial_start`, `note`, optional `mentor_email` / `trial_email`) and resolves the names against members with the same matcher the attendance pipeline uses. It is a dry run unless you pass `--apply`, and it reports every name it can't resolve or finds ambiguous (add the email columns to fix those). Imported rows are `kind = trial`, with the trial end filled from Stripe where it has the subscription. The dates in the CSV are history from the sheet; going forward nobody types one. **Never commit the CSV**: it names real people. Run it once against production with `.env.prod`, then delete the CSV.

## Not built yet

- Nothing nudges a big sister partway through (a check-in at the halfway mark, say), or reminds them to write the reason if they haven't.
- A new member can't ask for a different big sister; staff reassign from the Matches tab.
- Program membership: `member status` still treats any program enrollment as active, including Self-Editing Academy. The Big Sister rules above ignore programs without `includes_membership`, but that status logic is untouched.

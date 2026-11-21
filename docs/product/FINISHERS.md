# The Finisher record

> **Status:** living. Kept up to date with the code; if it is wrong, fix it.

What the Hub knows about a writer's milestones, kept apart from the project they came from. Words and the ladder (Writer, Finisher, Author, Published Author): `docs/product/WRITER_TITLES.md`. The plan around it, including the public Finishers page that is not built yet: `docs/TODO.md`, "Writer profiles: public author pages, Finishers, three-level visibility".

## What exists

Three milestones. Two are stored, one is derived:

| Milestone | Title it earns | Stored as | Stamp |
|---|---|---|---|
| Wrote THE END | Finisher | `member_milestones.kind = 'the_end'` | THE END |
| Revised until publish-ready | Author | `kind = 'publish_ready'` | one string, `PUBLISH_READY_STAMP` in `lib/finishers.ts` (still undecided) |
| Published | Published Author | not stored: a live row in `member_books` | n/a |

The third comes from the Bookshelf, so the two cannot disagree. A course completion (The Ready Writer and The 180 Program for THE END, Self-Editing Academy for publish-ready) may later pre-fill the question; it is never proof.

`member_milestones` (`mlst_` ids, Tier 2: never shown in a URL) holds one row per member and kind (and per project when one is linked): the date it happened (optional), a "before" and an "after" story (optional, 2000 characters each), where the row came from (`source`: member, project_stage, course or staff), its `status`, three consent flags and a soft delete. Code goes through `MilestoneRepository` (`lib/data/milestones.ts`); the words and parsing of a member's answer live in `lib/finishers.ts`.

## The rules

- **A row is a claim about a person, so the member confirms it.** Staff and courses can only *propose*: a row starts as `proposed`, and only the member moves it to `confirmed` or `declined`. The policies enforce it: an admin can add a staff proposal, and edit or take back one that is still a proposal, but cannot confirm for the member or touch a confirmed row. A member cannot change whose row it is. Nobody is notified in this version (see `docs/TODO.md`).
- **A member can add their own, without waiting for staff.** "I wrote THE END" and "My manuscript is publish-ready" open the same answer form and create the row as `source = 'member'`, `status = 'confirmed'` in one step (date, stories and ticks optional, every tick off). The INSERT policy allows only that: their own `member_id`, source `member`, status `confirmed` with a time, an optional project that is theirs and live, no book link, `created_by` themselves or empty, and never while an admin views as them (sudo). An admin cannot add one in a member's name. A consent can come in the same insert because the table's CHECK only needs the row to be confirmed. One live row per member and kind: adding a second returns the existing one (the repository looks for any live row of the kind, even one linked to a project, or one staff proposed), so the card shows it instead of an error.
- **Hidden until confirmed.** The table is readable by the member it is about and by admins, and by no one else: no other member, no visitor (no grant for anonymous). A proposal therefore shows nowhere public.
- **Consent is per use, off by default.** `consent_profile` (their public writer page), `consent_homepage` (counted and shown among the writers who finished) and `consent_testimonial` (quoted when we tell other writers what is possible) are separate ticks. The database refuses a consent on a row that is not confirmed, so declining clears them. A future reader of the table must check the flag for the use it serves; being confirmed is not consent to be shown.
- **The member can change their mind** in Settings, Profile, "Your milestones": confirm, change the ticks, or say "not me / not yet" on one staff proposed. A decline keeps the row (so a backfill does not ask again) and drops every consent. A milestone they added themselves has "Take it back" instead (after a confirmation): a soft delete, so the slot is free to add again, and the backfill still does not propose that kind again. Taking back needed the member to read their own deleted rows (Postgres checks the new row against the SELECT policy); the repository always filters on `deleted_at`, so a taken-back row never shows.
- **Sudo looks, never answers.** An admin viewing as a member can see the card; the action and the database refuse the write.

## The card

Settings, Profile, "Your milestones" is always shown (it used to appear only once staff had proposed something). Three rows, in plain words, with titles from `lib/finishers.ts` and `docs/product/WRITER_TITLES.md`:

- **Wrote THE END** (Finisher) and **publish-ready** (Author, stamp `PUBLISH_READY_STAMP`): each is *not added yet* (button "I wrote THE END" or "My manuscript is publish-ready"), *waiting for you to confirm* (staff proposed it: "Yes, this is me" or "Not me / not yet"), *confirmed* with the date when there is one (Change, and "Take it back" for their own entries or "Not me / not yet" for ones staff proposed), or *declined* ("Actually, it is me").
- **Published** (Published Author) is read-only: true when the member has a live book on the Bookshelf, with a link there. Nobody adds it, so the two cannot disagree.

The form's optional project picker lists their own live projects (`WritingRepository.activeProjects`); the action checks `ownsProject` and the policy checks it again.

## Staff

`/admin/finishers` (admin only): counts of proposed, confirmed and declined, the list (50 a page, optionally one status), "Propose from published books" and "Add one by hand" (member picker, one milestone).

- **Backfill.** A member with a live (not deleted) book has necessarily written THE END and revised it, so `propose_milestones_from_books()` proposes both kinds for each such member that has no row of that kind yet (any status, withdrawn ones included, so a decline or a take-back stays). It is one set-based statement run as the calling admin, so it has no page limit and a second run adds nothing. Members who cannot sign in (lapsed) still get proposals; they stay hidden.
- **Backfill and a member's own.** The backfill already skips any member with a row of that kind, so a member who added their own, or took it back, is not proposed that kind again.
- **Hand-add** creates one proposal; "Take back" soft-deletes a proposal the member has not answered.

## Data, removal and the Activity Log

- **Removal.** `member_data_handling` marks `member_milestones.member_id` as `delete`, so a member's removal request deletes the rows (and the entries about them leave the audit log, like the rest of their data). They are never part of the "keep my public work" choice.
- **Activity Log.** A proposal, a member adding their own ("added the THE END milestone"), a confirmation, a decline, a change of consent and a take-back are audit entries on the member (`member_milestone`), with the stories redacted; `describeRow` in `lib/activity-feed.ts` says them as sentences without dates or words the member wrote.
- **Analytics.** The member's answer is the `milestone_answered` action outcome ("confirmed" or "declined"); adding their own is `milestone_added` ("added" or "already_there") and taking it back `milestone_taken_back`. No content in any.

## Not here yet

Photo upload, the project-stage prompt, course pre-fill, notifying proposed members, the public Finishers page and the homepage numbers are in `docs/TODO.md`, "Finisher record: what is left".

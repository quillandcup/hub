# The Finisher record

> **Status:** living. **Last reviewed:** 2026-11-20. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

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
- **Hidden until confirmed.** The table is readable by the member it is about and by admins, and by no one else: no other member, no visitor (no grant for anonymous). A proposal therefore shows nowhere public.
- **Consent is per use, off by default.** `consent_profile` (their public writer page), `consent_homepage` (counted and shown among the writers who finished) and `consent_testimonial` (quoted when we tell other writers what is possible) are separate ticks. The database refuses a consent on a row that is not confirmed, so declining clears them. A future reader of the table must check the flag for the use it serves; being confirmed is not consent to be shown.
- **The member can change their mind** in Settings, Profile, "Your milestones": confirm, change the ticks, or say "not me / not yet". A decline keeps the row (so a backfill does not ask again) and drops every consent.
- **Sudo looks, never answers.** An admin viewing as a member can see the card; the action and the database refuse the write.

## Staff

`/admin/finishers` (admin only): counts of proposed, confirmed and declined, the list (50 a page, optionally one status), "Propose from published books" and "Add one by hand" (member picker, one milestone).

- **Backfill.** A member with a live (not deleted) book has necessarily written THE END and revised it, so `propose_milestones_from_books()` proposes both kinds for each such member that has no row of that kind yet (any status, withdrawn ones included, so a decline or a take-back stays). It is one set-based statement run as the calling admin, so it has no page limit and a second run adds nothing. Members who cannot sign in (lapsed) still get proposals; they stay hidden.
- **Hand-add** creates one proposal; "Take back" soft-deletes a proposal the member has not answered.

## Data, removal and the Activity Log

- **Removal.** `member_data_handling` marks `member_milestones.member_id` as `delete`, so a member's removal request deletes the rows (and the entries about them leave the audit log, like the rest of their data). They are never part of the "keep my public work" choice.
- **Activity Log.** A proposal, a confirmation, a decline, a change of consent and a take-back are audit entries on the member (`member_milestone`), with the stories redacted; `describeRow` in `lib/activity-feed.ts` says them as sentences without dates or words the member wrote.
- **Analytics.** The member's answer is the `milestone_answered` action outcome ("confirmed" or "declined"), no content.

## Not here yet

Photo upload, the project-stage prompt, course pre-fill, notifying proposed members, the public Finishers page and the homepage numbers are in `docs/TODO.md`, "Finisher record: what is left".

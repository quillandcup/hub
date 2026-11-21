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

`member_milestones` (`mlst_` ids, Tier 2: never shown in a URL) holds one row per member, kind **and work**. A milestone belongs to one work: a writing project (`project_id`) and/or a Bookshelf book (`book_id`; a book that has a project is the same work as that project, so the row carries both), or neither with a short `title` the member wrote for a work that is not listed (at most 120 characters, never in the Activity Log). The work key is the project when there is one, else the book, else the lower-cased title, else empty (a row from before works existed, still valid): `workKey` in `lib/finishers-works.ts` and the unique index `member_milestones_live_work_unique` say the same thing, so a member can have THE END for many works and one live row for each. A row also has the date it happened (optional), a "before" and an "after" story (optional, 2000 characters each), where it came from (`source`: member, project_stage, course or staff), its `status`, three consent flags and a soft delete. Code goes through `MilestoneRepository` (`lib/data/milestones.ts`); the words and parsing of a member's answer live in `lib/finishers.ts`, the work logic (keys, the card's works, the summary line) in `lib/finishers-works.ts`.

## The rules

- **A row is a claim about a person, so the member confirms it.** Staff and courses can only *propose*: a row starts as `proposed`, and only the member moves it to `confirmed` or `declined`. The policies enforce it: an admin can add a staff proposal, and edit or take back one that is still a proposal, but cannot confirm for the member or touch a confirmed row. A member cannot change whose row it is. Nobody is notified in this version (see `docs/TODO.md`).
- **A member can add their own, without waiting for staff.** "I wrote THE END" and "My manuscript is publish-ready" open the same answer form and create the row as `source = 'member'`, `status = 'confirmed'` in one step (date, stories and ticks optional, every tick off). The INSERT policy allows only that: their own `member_id`, source `member`, status `confirmed` with a time, an optional project that is theirs and live, no book link, `created_by` themselves or empty, and never while an admin views as them (sudo). An admin cannot add one in a member's name. A consent can come in the same insert because the table's CHECK only needs the row to be confirmed. One live row per member and kind: adding a second returns the existing one (the repository looks for any live row of the kind, even one linked to a project, or one staff proposed), so the card shows it instead of an error.
- **Hidden until confirmed.** The table is readable by the member it is about and by admins, and by no one else: no other member, no visitor (no grant for anonymous). A proposal therefore shows nowhere public.
- **Consent is per use, off by default.** `consent_profile` (their public writer profile), `consent_homepage` (counted and shown among the writers who finished) and `consent_testimonial` (quoted when we tell other writers what is possible) are separate ticks. The database refuses a consent on a row that is not confirmed, so declining clears them. A future reader of the table must check the flag for the use it serves; being confirmed is not consent to be shown.
- **The member can change their mind** in Settings, Profile, "Your milestones": confirm, change the ticks, or say "not me / not yet" on one staff proposed. A decline keeps the row (so a backfill does not ask again) and drops every consent. A milestone they added themselves has "Take it back" instead (after a confirmation): a soft delete, so the slot is free to add again, and the backfill still does not propose that kind again. Taking back needed the member to read their own deleted rows (Postgres checks the new row against the SELECT policy); the repository always filters on `deleted_at`, so a taken-back row never shows.
- **Sudo looks, never answers.** An admin viewing as a member can see the card; the action and the database refuse the write.

## The card

Settings, Profile, "Your milestones" is always shown. It lists the member's **works**: their writing projects and their Bookshelf books, deduplicated (a book with a project is that project's work), plus any work only a milestone knows (a title they added). Each work has its own rows, in plain words, with titles from `lib/finishers.ts` and `docs/product/WRITER_TITLES.md`:

- **THE END** (Finisher) and **publish-ready** (Author, stamp `PUBLISH_READY_STAMP`): *not added yet* (button "I wrote THE END" or "My manuscript is publish-ready"), *waiting for you to confirm* (staff proposed it: "Yes, this is me" or "Not me / not yet"), *confirmed* with the date when there is one (Change, and "Take it back" for their own entries or "Not me / not yet" for ones staff proposed), or *declined* ("Actually, it is me").
- **Published** (Published Author) appears on a work that is a Bookshelf book and is read-only; nobody adds it, so the two cannot disagree.
- **Compact**: works that have a milestone, are on the Bookshelf or are past the drafting stage (`isPastDrafting`: any phase after `drafting` in `PROJECT_PHASES`, except hibernating) come first; the rest are under "Show all my projects".
- **A summary line** says the titles in plain words from the whole set ("Published Author of 1 work · Author of 1 work · Finisher of 2 works"): each work counts once at its highest rung, only from a milestone the member confirmed or a book on the Bookshelf, so "Author" is never said for a work that is not publish-ready.
- **"Add a work that is not listed here"** takes a title and which milestone, then the same answer form.

Adding checks ownership twice: the action (`ownsProject`, the member's own books) and the INSERT policy (own live project, own live book). A book names its project (the action fills it in), a project that is not the book's is refused. A second add for the same work shows the existing row; the same kind for another work is a new row.

## Staff

`/admin/finishers` (admin only): counts of proposed, confirmed and declined, the list (50 a page, optionally one status), "Propose from published books" and "Add one by hand" (member picker, then one of their works or a title, then the milestone). The list shows the work of each row.

- **Backfill, per book.** `propose_milestones_for_books()` looks at every live (not deleted) book and proposes both kinds for that work unless the work already has a row of that kind in any status (withdrawn ones included, so a decline or a take-back stays). A book and its project are one work, so a row on either keeps the book from being proposed again; a member with several books gets several proposals. One set-based statement run as the calling admin, so it has no page limit, and a second run adds nothing. It returns proposals, members and books, which the page shows ("N proposals for M members across K books"). Members who cannot sign in (lapsed) still get proposals; they stay hidden. The older `propose_milestones_from_books()` (one pair per member) is still in the database until the contract step (`docs/TODO.md`).
- **Backfill and a member's own.** A work the member already added, or took back, is not proposed that kind again.
- **Hand-add** creates one proposal for one work (`loadWorksOfMember` lists the member's projects and books for the picker, or a title); "Take back" soft-deletes a proposal the member has not answered.

## Data, removal and the Activity Log

- **Removal.** `member_data_handling` marks `member_milestones.member_id` as `delete`, so a member's removal request deletes the rows (and the entries about them leave the audit log, like the rest of their data). They are never part of the "keep my public work" choice.
- **Activity Log.** A proposal, a member adding their own ("added the THE END milestone"), a confirmation, a decline, a change of consent and a take-back are audit entries on the member (`member_milestone`), with the stories redacted; `describeRow` in `lib/activity-feed.ts` says them as sentences without dates or words the member wrote.
- **Analytics.** The member's answer is the `milestone_answered` action outcome ("confirmed" or "declined"); adding their own is `milestone_added` ("added" or "already_there": per work) and taking it back `milestone_taken_back`. No content in any.

## Not here yet

Photo upload, the project-stage prompt, course pre-fill, notifying proposed members, the public Finishers page and the homepage numbers are in `docs/TODO.md`, "Finisher record: what is left".

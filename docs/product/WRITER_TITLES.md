# Writer titles

> **Status:** living. **Last reviewed:** 2026-11-19. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

The words we use for members and their milestones, in the Hub, on public pages, in emails and in the changelog. Decided by the owner (2026-11-19 and 2026-11-20). Use these words; ask before adding another.

## The ladder

| Who | Title | How a writer gets it |
|---|---|---|
| Anyone who writes | **Writer** | Always. "If you write, you're a writer." |
| Wrote THE END | **Finisher** | Finished a complete first draft. |
| Revised to be publish-ready | **Author** | Finished the final round of revisions, just before the optional publication step. |
| Published | **Published Author** | Has a published book (printed or digital) on the Bookshelf that came out on or after the day they joined (an earlier book stays on the Bookshelf but is not counted). |

Each rung keeps the one before it: a Published Author is also an Author, a Finisher and a Writer.

The three milestones line up with the end of the courses, which are also the usual prompts for them:

1. THE END: The Ready Writer or The 180 Program.
2. Publish-ready: Self-Editing Academy.
3. Published: the publishing courses planned for later.

A course completion can prompt the question but is never the proof. People also finish outside our courses.

## Rules

- **Going back a stage, or Hibernating, never cancels a milestone.** A milestone says what the writer did (decided 2026-11-21); the project-stage prompt only ever asks forward, once (`docs/product/FINISHERS.md`, "The project-stage prompt").
- **The feature is "writer profiles".** Every member can have a public page, and nobody has to earn it. Never call the pages "author pages".
- **Titles never gate features.** A writer with no milestone has the whole page. The milestones are things to celebrate on it, shown as a path with the next step in view, never as a gap.
- **Opt-in, per milestone and per use.** A milestone is shown only where the writer chose: the lock (only them), the house (other members) or the globe (their writer profile on the web, once it is on; members see it either way). A confirmed milestone starts at the globe, so the page is good enough the day they switch it on, and the form where they write the story shows that level with a plain line, one click to change it. The one marketing consent, "Share my story to inspire other writers", is separate and off until they tick it. Entries added by staff stay hidden until the writer confirms.
- **"Author" alone means publish-ready.** Copy that counts books ("Published author of 3 books") counts only published books, never "Author of 3 books" for a manuscript.
- **The third milestone is derived**, not stored: it comes from the books on the Bookshelf (`member_books`), so the two cannot disagree. The first two are stored (see the Finisher record).
- **Words we do not use** for these milestones: "Ready" (it belongs to The Ready Writer, which is the Finisher course), "Qualifier" (it belongs to gated runs), and running or contest jargon (placer, medalist, winner). A published book is not a win over another writer.

## Still open

- The name of the stamp for milestone 2 (the first is "THE END"). Candidates: FINAL DRAFT, POLISHED, THE LAST WORD. Keep it as one string in config so renaming is one change. Ask a few Finishers what they call the day they finish revising.

Related: the plan and the other decisions are in `docs/TODO.md`, "Writer profiles: public author pages, Finishers, three-level visibility".

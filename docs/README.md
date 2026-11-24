# Docs

Every doc is either **living** (maintained with the code; if it is wrong, that is a bug and the fix goes in the same PR as the change that made it wrong) or a **snapshot** (a decision or analysis as of a date, kept as history and not updated). The first lines of each doc say which, in a `> **Status:**` line. `tests/lib/docs-layout.test.ts` checks the layout. Docs name code by its path under `src/` (`src/lib/x.ts`; `public/`, `config/`, `scripts/`, `supabase/` and `tests/` sit at the root); the snapshots in `decisions/` and the build plans in `superpowers/` keep the paths of their time, from before the code moved into `src/`.

**Freshness.** Every living doc's Status line carries `**Last reviewed:** YYYY-MM-DD` and a cadence (`Review: quarterly.` for `checklists/`, `Review: yearly.` for the rest). A doc is overdue when its date plus its cadence is behind today; `never` is always overdue. `pnpm docs:overdue` prints the list, and the weekly `docs-overdue` workflow keeps one GitHub issue, "Docs overdue for review", with it. To clear an item, review the doc, fix what is wrong and bump its Last reviewed date. Whenever you edit a doc to make it correct, bump the date too. The tests check only that the date and cadence are well formed, so a doc going overdue never fails CI.

Each living folder has a `README.md` that lists its docs, each with its title and first sentence. It is generated: `pnpm docs:index` (`scripts/docs-index.ts`) rewrites the list between its two marker comments, the pre-commit hook runs it when a doc under `docs/` is staged, and `tests/lib/docs-layout.test.ts` fails if a list is out of date or a doc has no summary. So a new doc opens with its title and, after the Status line, a plain first sentence that says what it is. Text in the README outside the markers is yours to edit.

| Folder | Kind | What is in it |
|---|---|---|
| `runbooks/` | living | Step-by-step procedures (setup, inviting users, rotating secrets, the changelog process, the quillandcup.com domain move). Reviewed yearly. |
| `checklists/` | living | Lists to check the project against (Supabase, OpenSSF Best Practices, OSPS Baseline). Reviewed quarterly. |
| `architecture/` | living | How the data and the code are put together (layers, ERD, data access, identity matching, event log, the chat core and Slack seam). |
| `infrastructure/` | living | Setup and configuration of the services we run on (Vercel, Sentry, Slack, Mux, Kajabi, webhooks, calendar). |
| `trust/` | living | Security and privacy posture (row level security, staff MFA, threat model). |
| `quality/` | living | How quality is checked: the test suites, the guard tests that stop regressions, and the exception lists that still hold cleanup work. Reviewed yearly. |
| `product/` | living | How each feature works and why (attendance rules, check-ins, courses, landing pages, and so on). |
| `decisions/` | snapshot | Decisions and analyses tied to a moment, kept unchanged. New decisions are numbered ADRs (`NNNN-short-title.md`, template and rules in `decisions/README.md`); the earlier write-ups are snapshots with a dated header. |

`TODO.md` (the backlog) stays at the top of `docs/`. `superpowers/` holds specs and plans written while building; `members-import-example.csv` is a sample file for the unused Kajabi CSV import (removal: `TODO.md`).

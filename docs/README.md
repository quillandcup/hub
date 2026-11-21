# Docs

Every doc is either **living** (maintained with the code; if it is wrong, that is a bug and the fix goes in the same PR as the change that made it wrong) or a **snapshot** (a decision or analysis as of a date, kept as history and not updated). The first lines of each doc say which, in a `> **Status:**` line. `tests/lib/docs-layout.test.ts` checks the layout.

| Folder | Kind | What is in it |
|---|---|---|
| `runbooks/` | living | Step-by-step procedures (setup, inviting users, rotating secrets, the changelog process). Reviewed yearly. |
| `checklists/` | living | Lists to check the project against (Supabase, OpenSSF). Reviewed quarterly. |
| `architecture/` | living | How the data and the code are put together (layers, ERD, data access, identity matching, event log). |
| `infrastructure/` | living | Setup and configuration of the services we run on (Vercel, Sentry, Slack, Mux, Kajabi, webhooks, calendar). |
| `trust/` | living | Security and privacy posture (row level security, staff MFA, threat model). |
| `product/` | living | How each feature works and why (attendance rules, check-ins, courses, landing pages, and so on). |
| `decisions/` | snapshot | Plans, analyses and one-off write-ups tied to a moment. Kept unchanged. |

`TODO.md` (the backlog) stays at the top of `docs/`. `superpowers/` holds specs and plans written while building; `members-import-example.csv` is a sample file for the member import.

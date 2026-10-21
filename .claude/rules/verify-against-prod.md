## verify-against-prod

The local database is a seed, not a copy of production. Row counts, data shapes, which migrations are applied and how long something takes all differ, and plans built on local numbers have been wrong (e.g. "11 of 11 prickles lack a Zoom uuid" locally said nothing about prod). When a design, estimate or claim depends on real data, look at production first.

**Read production with the Supabase CLI, read-only:**
- Applied migrations: `supabase migration list --linked`. Check this before saying a table, column or migration is or isn't in prod, and when a migration-numbering check complains.
- Data shape and volume: `supabase db query --linked "<select ...>"` (or `-f file.sql`). Use `count(*)`, `min`/`max` dates, distinct values and `explain`; don't pull rows you don't need.
- Settings that matter for a plan, such as the statement timeout, from the same connection.

**Limits**
- Only `select`/`explain`. Never write, migrate, reset or delete in production from an agent session; writes go through a reviewed PR and CI (`push-migrations`), or the user runs them. If a one-off production write is truly needed, give the user the exact statement and ask.
- Production holds member data and the repo is public: use the results to decide and to report counts, but don't paste names, emails or other personal data into commits, docs, tests or PR text.
- A single query hits the 8s statement timeout on big tables (see the Slack reprocess notes in `CLAUDE.md`); page or narrow it instead of retrying.

**In the report, say where a number came from** ("prod: 1,312 events", "local: 11"). Don't project production timing from a laptop: when it matters, measure the same job in both places, or build a small benchmark, and use the ratio.

Before running a migration or backfill that rewrites a lot of rows, check prod's row count for the tables it touches and say whether it fits in the timeout.

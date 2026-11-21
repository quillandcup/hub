# Decisions

How we record a decision from now on: one short file per decision, in the style of architecture decision records (https://adr.github.io, the short MADR template).

- **File**: `NNNN-short-title.md`, numbered from `0001` in the order they are written, lowercase words joined by hyphens. Copy `0000-template.md`.
- **Fields**: `Status` (`proposed`, `accepted`, `superseded by NNNN` or `rejected`), `Date`, then `Context`, `Decision` and `Consequences`.
- **Rule**: a decision is not edited after it is accepted, except its Status. To change course, write a new ADR that supersedes it and set the old one's Status to `superseded by NNNN`.

`tests/lib/docs-layout.test.ts` checks that every ADR has a `Status:` line with one of those values.

## Earlier records

These predate ADRs. They are snapshots (a decision or analysis as of a date), kept with their names and text unchanged, and each has the snapshot header.

- `CHAT_VIDEOS_LAUNCH.md`
- `CI_MIGRATION_ORDERING.md`
- `KAJABI_DATA_MODEL.md`
- `KAJABI_SCRAPER_DESIGN.md`
- `KAJABI_ZAPIER_ANALYSIS.md`
- `NETWORK_RESTRICTIONS.md`
- `OVERVIEW_VIDEO_SCRIPT.md`
- `PAGE_SPEED.md`
- `PRD.md`
- `SHORT_IDS_PLAN.md`
- `SLACK_MULTI_WORKSPACE.md`
- `STRIPE_KAJABI_COMPARISON.md`
- `STRIPE_KAJABI_COMPARISON_POST_CLEANUP.md`
- `SUBSCRIPTION_ACTION_ITEMS.md`
- `TEST_INFRASTRUCTURE_PLAN.md`

# Billing reconciliation

> **Status:** living. **Last reviewed:** 2026-11-25. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Staff need to see where what Stripe billed disagrees with what the Hub expects, so they can fix Stripe or the Hub. The unit is **one member's purchase**: a schedule of the days a payment is expected, lined up against the Stripe transactions, with a status per day. It is read-only.

## The pieces

| Piece | Where |
|---|---|
| The pure model: `buildSchedules(input)` returns `PurchaseSchedule[]` (purchase type, member, rows). No database. | `src/lib/billing-reconciliation.ts` |
| The loader: reads inputs through the repositories (`loadMemberSchedules` for one member, `loadBillingOverview` for everyone) | `src/lib/billing-reconciliation-loader.ts` |
| One member's view: the Billing schedule above the payments on the Transactions tab (permission `member.transactions_tab`) | `src/components/BillingSchedule.tsx`, `src/app/(admin)/admin/members/[id]/` |
| The overview: members with a row that needs a look (permission `billing.reconciliation.read`, admin only) | `src/app/(admin)/admin/hygiene/billing-reconciliation/` |

Payment data is service role only (Bronze), so both entry points check the permission first and read through `getServiceRepos()`.

## How a membership schedule is built

- **Expected days.** For each Stripe subscription of the member (not `incomplete_expired`): the creation day, then the billing day of each following month (the day of the subscription's `billing_cycle_anchor`, clamped to short months) until it is cancelled. Today and later days are not expected yet. A paused subscription (`pause_collection`) expects nothing.
- **Not expected.** A billing day strictly inside a hiatus (`member_hiatus_history`) or a cohort of a program that includes membership (`programs.includes_membership`, read by `ProgramRepository.membershipEnrollmentWindows`). The first and last day of such a window are neither expected nor flagged: the first is the cycle that started it, the last the one that resumes billing.
- **Matching.** Each membership invoice (product named in `MEMBERSHIP_PRODUCT_NAMES`) matches the nearest expected day within 5 days, each side at most once, using Eastern days (`ORG_TIMEZONE`). A refund is read from the charges joined to the invoice (from either side).
- **Statuses.** `paid` (a failed charge that was retried and paid stays paid, with the tries in the reason), `refunded` (in full), `missed` (expected, no invoice, or only a draft or void one), `failed` (uncollectible, or open with a declined charge), `open`, `charged_when_not_expected` (a payment inside a hiatus or a program), `unexpected` (a payment matching no day), `not_expected`.
- **Needs attention.** `missed`, `failed` and `open` only for a member whose status is `active`; `charged_when_not_expected` and `unexpected` always. A program that ended more than 7 days ago with no membership billing since (no live subscription: none, cancelled or paused) is a `missed` row on the program's end day, for an active member.
- **Row keys** are member + purchase type + month (a counter when a month has several rows), stable so a row can be acknowledged later.

## Adding a purchase type (retreats, events, programs, courses)

`PURCHASE_TYPES` already names them. Add a builder next to `buildMembershipSchedule` that returns `PurchaseSchedule`s of its type with the same `ScheduleRow` statuses, and call it in `buildSchedules`. The component and the overview group by purchase and need no change.

## What the data says (production, 2026-11-25)

Read once with the checks above over the last 12 months: 128 schedules; 69 rows needed attention across 34 members (failed 34, unexpected 13, open 13, missed 5, charged when not expected 4). These counts move every day; the page is the source.

The billing-day question (does a hiatus that ends on the billing day skip an extra month?) is not confirmed: of 49 hiatuses ending on the member's billing day in the last two years, 37 were charged on the end day itself; 4 had their next membership payment 30 or 31 days later, 1 three days later, and 7 had none after it.

# Writing Projects Tracking

**Date:** 2026-08-28
**Status:** Roadmap / Not Started
**Scope:** New member-facing feature area — cross-cutting roadmap, to be broken into individual feature specs + plans as each phase is picked up

---

## Context

**Problem:** Members have no way to record what they actually *wrote* — word counts, scenes, chapters, editing passes — inside Hedgie Hub. That data currently lives nowhere, or scattered across members' own spreadsheets/third-party trackers/NaNoWriMo's site/a notebook. Hedgie Hub knows *when* someone showed up to write (`prickle_attendance`) but not *what came of it*.

**Solution:** A writing-project-tracking feature, modeled on indie writing-progress trackers (see analysis below) but integrated directly with Hedgie Hub's existing prickle/attendance/member data — so progress can be nudged for, logged in-context, and used as another engagement signal, instead of living in a disconnected third-party app.

**Dependencies:**
- Member Identity Management (`members`, `getEffectiveIdentity` — see `CLAUDE.md`)
- Attendance Data Ingestion (`prickles`, `prickle_attendance`)
- Slack messaging (already real, not just backlog) — the feedback flow (`app/api/feedback/route.ts`) and Wheel of Wonder (`app/(member)/wheel-of-wonder/actions.ts`) both already send real Slack messages/DMs today, each via its own direct `new WebClient(process.env.SLACK_BOT_TOKEN)` call. There is **no shared abstraction** yet (that part of `docs/TODO.md`'s "Messaging Abstraction Layer" is still just a backlog idea) — Phase 1's nudge/prompt (items 9–10) would be a *third* copy of the same direct-Slack pattern. Not a hard blocker (ship it the same way those two do), but a good trigger to finally extract a thin shared `sendSlackMessage()`/`sendSlackDM()` helper rather than adding a third inline `WebClient` call.
- Engagement scoring (already real, not just backlog) — `lib/member-engagement.ts`'s `computeMemberEngagementMetrics()` already computes a live, on-demand engagement score combining prickle attendance (10 pts/prickle) and Slack activity (`member_activities.engagement_value`, 1–3 pts), plus `riskLevel`/`engagementTier`. This is the CRM Features "Combined Engagement Scoring" work from `docs/TODO.md`, already shipped — not aspirational. The unused `members.engagement_score` DB column (default 0, nothing ever writes it) is a separate, dead artifact; don't confuse the two. Phase 1 item 11 adds a signal to the live function, not to that column.

**Scope:** This doc is the roadmap across all phases. Each phase gets its own spec (`docs/superpowers/specs/`) and plan (`docs/superpowers/plans/`) when picked up — this doc is not itself an implementation plan.

---

## Comparable Tools Analysis

This roadmap is informed by other writing-progress trackers (generically "the reference tool"). Relevant mechanics:

- **Tallies, not sessions:** progress is logged as dated entries in one of six measures (words, time, pages, chapters, scenes, lines), mixable within a project. Each entry is either *incremental* (+N) or *set new total* (replace count) — the toggle matters because writers often only know their running total, not the delta. Entries can be zero/negative (an editing pass that cut words still "counts" as a writing day) and can be logged for any date, with rollups recomputing retroactively.
- **Two goal types:** *Target* goals (a number, optionally with an end date — the reference tool draws a "par line" showing the pace needed to finish on time) and *Habit* goals (a recurring period — day/week/month/year — with an optional per-period threshold; blank threshold just means "logged something"). Streaks (current/longest/typical, hit-rate %) live entirely inside Habit goals, not as a separate system.
- **Leaderboards ("boards")** are real but lightly documented — participants, teams, members, described by users as mutual-encouragement relay boards rather than pure ranking.
- **No live third-party integrations exist** — no Scrivener, no Google Docs. The only "import" is a one-time migration path for old NaNoWriMo-site exports. There is a documented pull-only JSON API (CRUD on tallies/projects/goals/leaderboards) but **no webhooks** — nothing pushes to you.
- **Stated philosophy:** explicitly *not* a social network, not chat, not AI-powered, no ads, no premium tier, privacy-first. This is a strong signal for what to leave out of our version too (see Non-Goals).

*(Grounded in that tool's own public help docs and repo; a few philosophy/pricing claims trace through a secondary roundup source rather than the tool's own words directly — treat those as probable, not primary-sourced, if ever repeated externally.)*

**What's actually the differentiator here:** the basic act of logging a tally against a goal is table stakes — any tracker does that. What no standalone tracker can do is what Hedgie Hub already has the data to do: prompt for progress at the moment of lowest friction (inside a prickle the member is already in, via `prickles` + `prickle_attendance`) instead of requiring a separate app, and feed that progress into engagement scoring, at-risk detection, and member profiles. That's the **nudge-and-capture loop** (Phase 1), and it's the reason to build this at all rather than pointing members at an existing free tool.

That said, the richer tracking surface — habit-goal streaks, charts, multiple measures (Phase 2) — isn't an afterthought bolted on to chase a rival tool's feature list. It's a natural fit for what Hedgie Hub already is: a community app built around streaks and stats (`/streaks`, hosting-streak tracking, engagement tiers). It's sequenced after Phase 0/1 because there's no entry data to build a streak or chart from until members are actually logging progress — not because it's low value.

---

## Design Principles

1. **Prickle-anchored, not calendar-anchored.** A progress entry can optionally link to a `prickle_id`. The nudge/prompt flow (Phase 1) is what makes this feature worth using over a standalone tracker — don't ship Phase 0 without a credible path to Phase 1.
2. **Low friction over rich data.** A member who logs "wrote today" with no number is more valuable than a member who gives up because the form asked for too much. Default to the simplest possible entry (amount + measure), everything else optional.
3. **Sequence by data availability, not by perceived value.** Habit-goal streaks, charts, and multi-measure tracking are squarely in-line with Hedgie Hub's existing identity — it already surfaces streak-based stats elsewhere (`/streaks` for attendance, hosting streaks backlogged in `docs/TODO.md`, engagement tiers) — so these aren't scope creep or parity-chasing against an outside tool. They land in Phase 2 purely because there's no progress-entry data to chart or stream a streak from until Phase 0/1 are live and members have actually logged something; build them once that data exists, not because they're lower priority on merit.
4. **Local layer, not Silver.** Progress entries and goals are data this app owns outright (member self-reported, not derived from an external Bronze source) — normal CRUD, no reprocessing pipeline, same pattern as `member_hiatus_history`. See `CLAUDE.md` → Data Architecture.
5. **Reuse `getEffectiveIdentity`, not a parallel auth path.** All member-facing writing-project pages/actions must resolve identity the same way `/calendar` and `/dashboard` already do, so sudo'd admin browsing works here too.
6. **No leaderboards for writing progress.** Ranking members against each other on words/streaks doesn't fit this community — deliberately not building one, even though the mechanics would be cheap to add on top of Phase 2's data. Not to be confused with the separately backlogged Community Builder Leaderboard (`docs/TODO.md`), which is invite/referral-count-based and unaffected by this decision.

---

## Data Model (sketch — finalize in the Phase 0 spec)

```sql
-- LOCAL: member-owned, not reprocessed
CREATE TABLE writing_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'drafting', -- planning|drafting|revising|on_hold|complete|abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- LOCAL: member-owned, not reprocessed
CREATE TABLE writing_progress_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES writing_projects(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  prickle_id UUID REFERENCES prickles(id) ON DELETE SET NULL, -- nullable: not all writing happens in a prickle
  entry_date DATE NOT NULL,
  measure TEXT NOT NULL, -- words|time_minutes|pages|chapters|scenes|lines
  mode TEXT NOT NULL,    -- 'delta' | 'set_total'
  amount NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LOCAL: member-owned, not reprocessed
CREATE TABLE writing_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  project_id UUID REFERENCES writing_projects(id) ON DELETE CASCADE, -- null = spans all of a member's projects
  goal_type TEXT NOT NULL, -- 'target' | 'habit'
  measure TEXT NOT NULL,
  target_amount NUMERIC,           -- target goals
  start_date DATE,
  end_date DATE,                   -- target goals (drives the par line)
  habit_period TEXT,               -- habit goals: day|week|month
  habit_threshold NUMERIC,         -- habit goals: null = "anything counts"
  is_starred BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS: a member can only read/write their own `writing_*` rows, resolved via `effectiveIdentity.memberId` (so sudo works); admins get read access for support, same pattern as other member-scoped tables.

---

## Roadmap

### Phase 0 — Foundation (MVP, ship first)

The smallest version that's genuinely useful without any prickle integration yet.

1. Schema + RLS for `writing_projects` / `writing_progress_entries` / `writing_goals` (target-goal columns only for now)
2. "Log Progress" modal — measure dropdown, delta-vs-set-total toggle, amount, optional note, date (defaults to today) — reachable from a new `/writing` member route, following the `app/(member)/` pattern
3. Project list + project detail page — cumulative total, entry table with inline edit/delete of the member's own entries
4. One or more target-type goals per project, each with a par-line-style progress bar (simplest version of a goal — habit-type goals come in Phase 2)
5. Starred-goal widget on the existing `/dashboard`
6. Tests: entry math (delta vs. set-total, backdated entries recompute totals correctly), RLS (member A cannot read/write member B's rows), sudo compatibility

**Not in Phase 0:** habit goals, prickle linking, charts beyond a simple progress bar, any notification.

### Phase 1 — Prickle Integration (the actual differentiator)

Items 9–10 send real Slack messages the same way the feedback flow and Wheel of Wonder already do today — not blocked on a messaging abstraction layer existing first. Worth factoring a shared `sendSlackMessage()`/`sendSlackDM()` helper out of the three call sites while building this, since three independent `WebClient` instantiations is the point a small shared helper starts paying for itself — but that extraction is a refactor to do alongside Phase 1, not a prerequisite blocking it.

7. Attach a progress entry to a prickle from the prickle detail page (`app/(member)/prickles/[id]`) — "What did you write here?" for the member's own attendance record
8. Habit goal variant driven by `prickle_attendance` rather than a separate check-in: "log progress in prickles I attend" — computed from the join of `prickle_attendance` + `writing_progress_entries`, no new tracking mechanism needed
9. **Pre-prickle nudge:** Slack DM ~15–30 min before a prickle the member regularly attends: "Ready for [Prickle]? What are you working on today?" (same `@slack/web-api` pattern as `wheel-of-wonder/actions.ts`)
10. **Post-prickle prompt:** after `meeting.ended` (existing Zoom webhook hook point, same place the Host Confirmation Flow attaches), DM attendees with an active project a one-tap quick-log using an inline Block Kit dropdown/button in the message itself (not a modal — no `trigger_id` round-trip needed, one request instead of two). **New infrastructure required, verified against `slack-app-manifest.yml`:** Interactivity & Shortcuts isn't enabled on this Slack app today (no `settings.interactivity` block; the webhook at `app/api/webhooks/slack/route.ts` only handles Events API `event_callback`, not `block_actions`). Needs: (a) `settings.interactivity: { is_enabled: true, request_url: ... }` added to the manifest, (b) a new endpoint (interactivity payloads are `application/x-www-form-urlencoded` with a `payload` JSON field, not the JSON body the existing handler parses — can't just extend it) reusing the existing HMAC signature-verification logic against the raw body. Existing bot scopes (`chat:write`, `im:write`, `mpim:write`) already cover it — no new OAuth scopes needed.
11. Add consistent progress-logging as a third weighted signal in `lib/member-engagement.ts`'s `computeMemberEngagementMetrics()`, alongside prickle attendance and Slack activity — extends the live scoring function, not the unused `engagement_score` column

### Phase 2 — Richer Stats & Light Social

Sequenced after Phase 0/1 because it needs real progress-entry data to be worth building (see Design Principle 3) — not because items 12–14 are lower value. Habit-goal streaks/charts/multi-measure tracking are a natural extension of Hedgie Hub's existing streak-and-stats identity (`/streaks`, hosting streaks, engagement tiers); this is the phase where writing progress gets folded into that same pattern. No leaderboard here — see Design Principle 6 and Non-Goals; "light social" is limited to opt-in profile surfacing (item 15).

12. Full habit goals (independent recurring period, not just prickle-driven) with streak/gauge UI (current/longest/typical streak length, hit-rate %)
13. Additional measures (time, pages, chapters, scenes, lines) and entry tags
14. Cumulative + heatmap charts per project (Recharts — already a dependency, no new library needed)
15. Opt-in surfacing of a member's active project/streak on their existing `/members/[id]` profile page (opt-out mindset matches the Community Builder Leaderboard consideration already in `docs/TODO.md`)
16. CSV export of a member's own entries — low effort, high trust value, and a straightforward off-ramp if a member wants to move data elsewhere

**Not in scope for this doc — parked in `docs/TODO.md`:** collaborative/multi-author projects (e.g. a shared-universe anthology where several members each write their own book). The core data model here is single-owner only; collaboration needs its own scoping pass (at minimum: a "collection" grouping independently-owned projects vs. true multi-author co-ownership of one project are genuinely different problems) once the single-author loop above is proven out.

### Phase 3 — External Integrations (needs scoping, speculative)

18. **Google Docs word-count polling** — needs scoping before any implementation: per-member OAuth consent, cost/complexity of polling the Docs API on a schedule, and how to turn "current doc word count" into a delta rather than just a snapshot (Google Docs revision history doesn't cleanly map to "words added since last check"). Do not start building until scoped.
19. **Scrivener** — Scrivener is offline desktop software with no live sync API, so real-time tracking is not achievable regardless of effort spent. The realistic deliverable here is a manual export/import (member pastes or uploads a word-count snapshot), not an integration — scope it as that from the start rather than promising sync.

---

## Non-Goals (explicitly out of scope)

- **Leaderboards ranking members by writing volume/streaks.** Doesn't fit the tone of this community — a member who writes less isn't "losing." (Separately: the backlogged Community Builder Leaderboard in `docs/TODO.md` is invite/referral-count-based and unrelated to this decision.)
- **Real-time Scrivener sync.** Not technically possible — Scrivener has no public sync API. Don't scope or promise this; see Phase 3 item 19 for the honest version.
- **Chat or messaging features beyond the Phase 1 nudge/prompt.** The nudge and post-prickle prompt are single-purpose transactional messages through the existing messaging abstraction layer — not a new in-app chat surface.

---

## Next Steps

1. Review this roadmap and confirm phase ordering/priority
2. Write the Phase 0 spec (schema, RLS, `/writing` routes) and implementation plan
3. Phase 0 should ship and get real member usage before committing to Phase 1's messaging-layer dependency

# Prospecting: finding ideal Hedgies on Instagram

Phase 5 of the CRM roadmap in `docs/TODO.md`, started as a small, deterministic MVP. The goal: a steady supply of writers who would love Quill & Cup, so that Ania's daily outreach starts from a ranked list instead of from scrolling.

## What exists

```
 discover ──► normalize + dedupe ──► score (rules) ──► [AI read, optional] ──► human review ──► Ania reaches out
 (paste today)   lib/prospecting/        lib/prospecting/    scripts/assess-prospects.ts   /admin/outreach/prospects    from her own account
                 candidates.ts, import   rules.ts, score.ts  lib/prospecting/assessment.ts
```

- **Table** `outreach_prospects` (admin only; `ProspectRepository` in `lib/data/prospects.ts`). One row per Instagram handle. Re-adding a handle changes nothing, so a reviewed prospect is never overwritten and a source can be re-run.
- **Discovery (MVP): paste.** On `/admin/outreach/prospects`, one prospect per line: the @handle or profile link, then anything copied from the profile (bio, "2.3k followers", #hashtags, a link). Handles that belong to a member or lead already in the Hub (`members.instagram_url`) are skipped.
- **Scoring: rules, not AI.** `lib/prospecting/rules.ts` is a list of weighted patterns over the bio and hashtags plus a follower range. `scoreProspect` is deterministic and returns the reasons, which the review page shows. Changing who we look for is a change to that one file; `ProspectRepository.rescore` re-applies it to everyone.
- **Review.** To review → Shortlisted → Contacted, or Rejected (with an optional reason, which is the best data we will have for tuning the rules). Whether a prospect later joined is derived by matching the handle to members, never stored (CLAUDE.md, "Business Facts").
- **AI read, on demand and advisory.** `pnpm prospects:assess [env-file] [--limit=20] [--apply]` runs the Claude Code CLI headless (`claude -p`, no tools, empty temp directory) over prospects without an assessment and stores a fit (`strong`/`maybe`/`weak`), a one-line summary and a draft opener. It uses the Claude subscription logged in on the machine that runs it. The page shows it beside the rules' score. Nothing is sent to anyone and no status changes.

## Decisions and the arguments behind them

**1. Rules first, AI second.** Rules are free, instant, explainable ("+30 says they are working on a book") and repeatable, and most of what makes someone an ideal Hedgie is visible as words in a bio. AI earns its place only where rules are weak: reading free text for *meaning* ("I'm a coach who helps authors" vs "I'm an author who needs a coach") and drafting an opener that refers to something specific. So the AI step runs on the shortlist, not on everything, and its output is advice stored next to the score. A model's judgment is also less consistent from run to run than a rule, which is a reason to keep the score itself deterministic.

**2. No logged-in scraping of Instagram.** Automating a logged-in Instagram session or scraping profiles breaks Meta's terms and the usual result is a restricted or banned account. The account at risk would be Quill & Cup's (or Ania's), which is also where the outreach itself happens. That risk outweighs the convenience, so the MVP never touches Instagram's site. Options for a real discovery source, in order of how much I would trust them:
  1. **Humans find, the Hub scores** (built). Ania already browses hashtags; pasting what she sees takes seconds per profile.
  2. **Meta's official APIs.** Hashtag search and business discovery need a Business/Creator account linked to a Facebook Page and an app that passes Meta's review. Business discovery only returns *business/creator* accounts, and hashtag search has a per-week hashtag limit and returns posts, not always the author. What is actually returned must be confirmed before building on it (open question below).
  3. **A third-party data vendor.** Possible, but it moves personal data to a processor and still sits in a gray area; needs a privacy review first.
  4. **Other places writers announce themselves** (writing-community directories, public author sites, newsletter sign-ups, event attendee lists) feed the same table with a different `source`. These may be better prospects than Instagram anyway.

**3. People first, then a bot.** The reviewer is always a person, and so is the sender. Cold outreach to strangers drafted by an AI carries real brand risk if it goes out unreviewed (TODO.md already says so). The bot's job is to shrink the haystack and write a first draft.

**4. Privacy.** The table stores what a person chose to publish on their profile (handle, bio, hashtags, public link), nothing private, and only admins can read it. It is not a member record: nothing is shared with anyone, and if a prospect asks to be removed the row is deleted. Before any automated discovery: decide the retention (rejected prospects probably expire), and whether the privacy policy needs a line about it, especially for prospects in GDPR countries (`lib/gdpr-countries.ts`).

**5. Using a Claude subscription.** A Claude subscription signs in the Claude Code CLI, so a script that shells out to `claude -p` on your own machine works (checked: it answers on the subscription). It cannot be used from the deployed app: the Hub on Vercel would need an Anthropic API key (billed per token), and putting a personal subscription login on a server for an automated product is not what the subscription is for. So: the discovery and scoring parts run anywhere, and the AI read is a local, run-it-yourself step (or a scheduled `launchd` job on the Mac, if you want it nightly). If it later needs to run unattended in the cloud, that is an API key, a `ProspectAssessor` behind the same `parseAssessment` shape, and a monthly cost that is small at 20-50 profiles a day.

## What is not built yet

- A discovery source that runs by itself (see decision 2). The table has a `source` column and `ProspectRepository.addMany` so a source only has to produce `NewProspect`s.
- Going from "contacted" to the existing Outreach queue: today a prospect who signs up shows up there through Kajabi's "Instagram Handle" field, as before. Logging a prospect touch (so the daily 25 includes prospects) needs a decision on whether prospects become `members` rows; see the questions.
- Learning from outcomes: rejections (with reasons), replies and sign-ups are the training signal for the rules and for Phase 4's scoring. Nothing reads them yet.
- Analytics: `prospects_imported` and `prospect_reviewed` outcomes are recorded; a funnel (found → shortlisted → contacted → joined) is not defined in `lib/analytics/funnels.ts`.

## Questions for Ania

Answers go into `lib/prospecting/rules.ts` (the first guess there is mine, not hers). Short answers or examples are fine; screenshots of three great fits and three bad ones would be better than any description.

**Who is an ideal Hedgie?**
1. In a sentence, who is the best member we have ever had, and how did they describe themselves on Instagram when they found us?
2. What signals in a profile make you say "yes" in the first five seconds? (words in the bio, hashtags, what they post, the way they write)
3. What makes you skip someone immediately? (coaches, editors, ghostwriters, promo accounts, huge accounts, inactive accounts, anything else)
4. Does it matter what they write (fiction, memoir, poetry, nonfiction), what stage they are at (idea, drafting, revising, published), or genre? Do we want published authors, or mostly people still drafting?
5. Do follower counts matter? What is too small to be real and too big to be a peer?
6. Does location or time zone matter? Language (English only)? Age or life stage?
7. Which of the members who left were *not* ideal after all, and what did their profiles have in common?

**How do you find people today?**
8. Where do you look: hashtags (which ones), who follows other writing accounts, comments on writing posts, Reels, Stories, other platforms (TikTok, Substack, Threads, Reddit)?
9. How long does it take to go from opening Instagram to a person you are happy to message? How many profiles do you open for each one you message?
10. What do you read on a profile before deciding: bio, link, last posts, captions, comments, highlights, following list? Which of those could I give you in a list so you do not have to open the profile?
11. Do you keep any list of people you looked at and passed on, or ones to come back to?

**How do you reach out?**
12. What do you actually send (please share three real messages, names removed) and what do you reference from their profile to make it personal?
13. Which of your messages get a reply? What do the replies have in common?
14. From which account do you send (the Quill & Cup account, your own), and how many a day before it feels risky? Has Instagram ever limited the account?
15. What is the next step you offer (a trial prickle, a call, a link)? What happens after a yes?
16. When someone does not reply, do you follow up, and when?

**What should the bot do, and not do?**
17. Would you prefer a ranked list of ten to review each morning, or a stream you can dip into? How many do you want to review in a day?
18. Do you want a drafted first message to edit, or only the reasons someone is a good fit? If drafted: should it sound like you, and could you share five of your best messages so it can learn the voice?
19. Is it fine for the bot to look only at what is public, and never follow, like or message anyone from the account? (My recommendation: yes.)
20. Is there anyone we must never contact (competitors, former members who asked to be left alone, friends)?

**Measuring**
21. What does success look like for one prospect (reply, booked trial, paid member), and how long after the first message do you usually know?
22. Do you track replies anywhere besides memory and Instagram? Would you log "replied" and "not interested" in the Hub if it took one tap?

## Next steps

1. Ania answers the questions; rewrite `rules.ts` from her answers and add rule tests from her real examples.
2. Choose a discovery source (decision 2): confirm what Meta's API returns for the account that would send, or pick a non-Instagram source to start.
3. Log prospect touches and decide whether prospects feed the daily queue (needs a decision about `members` rows for people without an email).
4. Funnel and outcome analytics, then Phase 4 scoring from real outcomes.

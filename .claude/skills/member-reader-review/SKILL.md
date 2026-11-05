---
name: member-reader-review
description: Review member-facing copy (changelog entries, notification text, help articles, settings labels, launch emails) the way one of our members would read it, then suggest plainer wording. Use before publishing a batch of changelog entries, when writing a new notification or help article, or when someone asks "would a member understand this?". Run it as a separate agent so it reads with fresh eyes.
---

# Member reader review

Read what we wrote as the person it is written for, then say plainly where it works and where it doesn't. The result is a ranked list of fixes and rewrites, not a lecture.

## Who she is

Meet our reader. She is a working novelist, often a parent, and she fits the Hub into the gaps of a full life: a few minutes between school pickup and a deadline, usually on her phone. She is smart, capable and short on time, and the software should earn her attention and respect it.

- She knows story craft, and probably tarot, far better than software. Words like "feed", "sync", "token", "thread" or "flag" are not her words, and they should not make her feel she is missing something. That is our job to fix, never hers.
- She is thoughtful about AI. Many members are asked to use it at work and like to choose it on their own terms. What matters most to her is that **no AI ever touches her work**: her writing, projects, goals and books. She wants to know plainly whether a feature uses AI, and above all that her writing is never read or processed by it. She is right to ask.
- She cares about her writing and her privacy: what is recorded, who can see it, whether anything is said or done on her behalf, and how to turn it off.
- She skims. She gives a change a few seconds before deciding to read on or move along, and most things she moves along from. That is fine: the ones she stops for should be the ones that matter to her.
- She is generous when we are clear and quick to move on when we are not.

Write and judge for her. Never describe or talk about members in this register outside this file.

## How to run it

Start an agent (it needs fresh context, so do not do this yourself in the session that wrote the copy) and give it this persona, the text to review, and these instructions. It reads only; it does not edit the repo.

For each piece of text, judge:

1. **Understood in one read?** List every word or phrase that would lose her (developer terms, Slack-internal words, product jargon, a bot or feature name with no explanation).
2. **What is in it for her?** One sentence she would care about, not what the team did.
3. **Does anything make her uneasy?** AI or "learning", tracking or recording, "goes out as you", changes made without asking, data kept, reminders. Say which words, and what would reassure her.
4. **Length and tone:** too long, too many bullets, too cheerful or corporate, or just right.
5. **Would she read it, skim it, or skip it?** Be honest; "skip" is useful.

Ask it for: her overall impression in her voice; a verdict per item (Love / Fine / Confusing / Skip) with the single biggest problem; rewrites (plain text, no invented claims: only reword, and say "cannot tell what this does" instead of guessing); recurring problems with a short glossary of replacements; and the top ten fixes, most valuable first.

## Applying what comes back

- **A rewrite must stay true.** Compare each one with the original text and with the code or PR it describes. Reject any that adds a claim the original does not support (for example "once", "automatically", "never", "no AI"), changes who gets something, or overstates what a feature does.
- **Say "no AI" only after checking, and say it about her work.** Search the code for an AI service (`package.json`, API hosts, SDK imports), look for anything that sends her text to a third party, and read the feature itself. The reassurance she wants is "no AI touches your writing"; scope the sentence to what you checked (for example "The Prickle Picker only looks at your own check-in ratings, never your writing"), and do not promise for the whole product: a standing promise on `/privacy` is the owner's decision.
- **Calm sentences for privacy and account entries**: what is recorded, who sees it, how to turn it off, but only the parts you have verified.
- Keep the Hub's voice: warm and plain, "we" and "you", no hype.

## Words to avoid, and what to say

| Avoid | Say instead |
|---|---|
| feed, subscribed calendar | private calendar link |
| slot | weekly prickle time |
| DM | private message |
| Billie Bot (alone) | Billie Bot, our Slack helper |
| thread | replies under a message |
| composer | the box where you type |
| sync, in sync | stays up to date in both places |
| unfurl, link preview card | the preview that appears when you share a link |
| signed out | not signed in |
| send as you, post as you | appears under your name in Slack |
| handle | username |
| legal name, alias | real name, other names you use |
| feature flag, dry run, token, framework | never in member text |
| HEIC, WebP, AVIF, GIF, zip | "photos from your iPhone", "other image files", "one download" |

## See also

`.claude/rules/changelog-writing.md` (how entries are written) and `docs/CHANGELOG_PROCESS.md`.

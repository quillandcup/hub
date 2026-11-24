# Product

How each feature works and why.

<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->

- [Usage analytics](ANALYTICS.md): How the Hub finds out whether a feature earns its place: a log of what members do, and funnels over it
- [Attendance Tracking Rules & Thresholds](ATTENDANCE_RULES.md): This document defines all the rules and time thresholds used in the attendance tracking system
- [Big Sister program](BIG_SISTERS.md): Every new member is matched with an existing member (their big sister) for 30 days: someone who shows them around, answers the questions that are easier to ask a person, and invites them to prickles
- [Events from the shared calendar](CALENDAR_EVENTS.md): An event is a thing members can see in Events (a retreat, a workshop, a speaker session, a listed prickle)
- [Prickle Check-ins: What We Ask and Why](CHECKINS.md): A check-in is a few taps before and after a prickle, answered on the site (the check-in / check-out modal, Log Progress, Find a Prickle) or in the Slack DMs
- [Check-ins and Check-outs: When and Where They Appear](CHECKIN_DELIVERY.md): What the questions are, and why, is in `CHECKINS.md`
- [Commitments](COMMITMENTS.md): A commitment is a member's promise to attend one or more recurring prickle slots for a set number of weeks: "Mondays 7am Progress Prickle for the next 4 weeks", or "M/W/F 5am Sprint for 4 weeks." It'…
- [Courses in the Hub](COURSES.md): Plan for moving Quill & Cup's courses from Kajabi into the Hub, starting with The Ready Writer, which launches in about two weeks (target: early November 2026)
- [Reproducible Demo and Help Docs](DEMO_AND_HELP.md): One mechanism, two outputs: a fictional demo community seeded into a local stack, and Playwright scenes that drive the app and capture screenshots and clips
- [The Finisher record](FINISHERS.md): What the Hub knows about a writer's milestones, kept apart from the project they came from
- [Hedgie Care: tracking a community manager's reach-outs](HEDGIE_CARE.md): The community manager reaches out to members (an introduction, a check-in on their writing, a welcome back) and some of those turn into long conversations
- [Landing pages (the page builder)](LANDING_PAGES.md): Status: slice 1 built: the model, the editor, the blocks, publishing with history, the public route
- [Media library](MEDIA_LIBRARY.md): Status: foundation built (table, bucket, repository, upload and serving routes, presets; no UI yet)
- [Member Merge](MEMBER_MERGE.md): Merging combines two member records into one, transferring all associated data to the primary (kept) member and permanently deleting the secondary (duplicate)
- [Member Reminders](MEMBER_REMINDERS.md): Two reminders the Hub sends on its own, from one hourly job
- [Prospecting: finding ideal Hedgies on Instagram](PROSPECTING.md): Phase 5 of the CRM roadmap in `docs/TODO.md`, started as a small, deterministic MVP
- [Slack-Bridged Chat: Design](SLACK_BRIDGED_CHAT.md): Code layout: chat core calls Slack only through a transport port, with Slack as the adapter behind it (`docs/architecture/CHAT_MODULE.md`)
- [Writer profiles](WRITER_PROFILES.md): A member can opt in to a page of their own on the open web, at an address they choose: `/w/<handle>`
- [Writer titles](WRITER_TITLES.md): The words we use for members and their milestones, in the Hub, on public pages, in emails and in the changelog

<!-- END docs-index -->

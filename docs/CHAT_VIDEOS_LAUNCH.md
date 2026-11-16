# Lesson videos in chat: launch notes

`chat_videos` went on for everyone on 2026-11-12 at 5:40 PM Eastern (production audit log, `feature_flag` row). This file records what was published for it and what is still open.

## Published with the launch

- The engineering entry `lesson-videos-in-chat-building-blocks` (admin changelog only).
- The product entry `lesson-videos-in-chat` (marked major: the first feature that works only in Hub Chat), with three screenshots in `public/changelog/lesson-videos-in-chat/` taken from the demo community with `demo/scenes/changelog/lesson-videos-in-chat.spec.ts`. The demo seed has one lesson with a ready (made-up) video and a craft-talk message that shares it (`demo/courses-seed.ts`, `seedChatVideoShare` in `demo/chat-seed.ts`).
- The help article `help/share-a-lesson-video-in-chat.md` (in `HELP_ORDER`), with `demo/scenes/share-a-lesson-video-in-chat.spec.ts` for its screenshots.
- `chat_videos` in `LIVE_FLAGS` (`lib/changelog/live-flags.ts`).
- The copy went through the member reader review (`.claude/skills/member-reader-review`).

## Why it is in Hub Chat only (the owner's context, in the entry)

The team has wanted lesson videos in conversations for years. Slack never allowed it with a good experience: it cannot keep track of what a member has watched, or pick a long video back up where they stopped. Hub Chat can, so this is the first feature that works only there, and a reason to move conversations from Slack to Hub Chat. The entry says so plainly and promises only what works: keeping the place, recording which parts were watched, and (since the completion change) marking the lesson complete once nearly all of it is watched.

## Still open

- Kajabi images for the draft courses (`docs/TODO.md`).

## `/privacy`

Checked against the code on 2026-11-12, and the Course videos row updated the same day to match: it now says that for a video shared in a chat message, which message it was watched in is recorded too, that turning usage statistics off does not change it (watching is part of how courses work, the same on the lesson page), and that the reason includes marking a lesson complete once it is watched.

- **Watch history.** A view in a chat message is recorded exactly like a view on the lesson page: where the member stopped, which parts they watched, speed, captions, whether the tab was in view, device and browser (`WatchTracker` in `components/courses/LessonPlayer.tsx`, `/api/courses/watch`), for a member's open lessons and not in sudo. The one addition is `video_watch_segments.chat_message_id`: which chat message it was watched in, so the course stats can keep chat views apart. `/privacy` says course viewing is recorded "to pick up where you left off, and to learn which lessons work"; it does not mention that a view can be tied to a chat message. Like lesson viewing, it is not behind the "leave me out of statistics" switch (that switch covers the usage log, `lib/analytics/opt-out.ts`).
- **Playback quality.** The chat player is given no `muxData`, so nothing about how a chat video plays goes to the video provider's quality measurement, switch or not (`components/chat/ChatVideo.tsx`; the lesson page passes it only where usage statistics are on).
- **Usage log.** Pressing the card is one click event (`data-track="chat-video-open"`) in the usage log, which the switch does cover.
- **Who sees it.** Admins, in the course watch stats, kept apart from the lesson's own views. Other members see only the card (the lesson's title and its course), never who watched.
- **Slack.** The author's own connected Slack account edits their message to add the links back to the Hub (`rewriteInSlack`); the Hub never posts or edits as anyone else.
- **Third parties.** Nothing a member writes or watches goes anywhere new: the video provider already serves the lesson videos, and no AI service is involved in any of it.

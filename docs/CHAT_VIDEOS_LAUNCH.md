# Lesson videos in chat: what to publish when the flag goes on

`chat_videos` (`lib/features.ts`) is not on for everyone yet, so the member-facing pieces are written and waiting: publishing them now would describe something most members cannot use (`.claude/rules/changelog-writing.md`: a flagged feature ships the day the flag goes on for everyone). The PR that holds them is opened as a draft for that reason.

## What is already written (2026-11-12)

- The engineering entry `lesson-videos-in-chat-building-blocks` (admin changelog only), already live.
- The product entry `lesson-videos-in-chat` in `lib/changelog/entries.ts`, with three screenshots in `public/changelog/lesson-videos-in-chat/` (a card in a conversation, what someone without the course sees, the share box). Taken from the demo community with `demo/scenes/changelog/lesson-videos-in-chat.spec.ts`; the seed has one lesson with a ready (made-up) video and a craft-talk message that shares it (`demo/courses-seed.ts`, `seedChatVideoShare` in `demo/chat-seed.ts`), and the flag on for the demo. Its date is a placeholder.
- The help article `help/share-a-lesson-video-in-chat.md` (listed in `HELP_ORDER`, `lib/help.ts`), with its screenshots from `demo/scenes/share-a-lesson-video-in-chat.spec.ts`.
- The member reader review (`.claude/skills/member-reader-review`) ran on the entry and the article; its fixes are applied: say plainly that watching is recorded and who can see it, "replies under a message" for "thread", "Delete your message", Hub Chat explained, and which place plays the video.

## The day the flag goes on for everyone

1. Read the day from the production audit log (read-only): `audit_log` rows with `entity_type = 'feature_flag'` where `enabled_globally` goes true. Set it as the `date` of the product entry.
2. Merge the draft PR the same day (take it out of draft). The deploy publishes the entry, the article and the screenshots together.
3. Add `chat_videos` to `LIVE_FLAGS` (`lib/changelog/live-flags.ts`) so the drafter stops holding PRs that name it.
4. Look at `/privacy` against the section below, and decide whether to add "and, for a video shared in chat, which message it was in" to the Course videos row.

## Check `/privacy` before the flag goes wide

Checked against the code on 2026-11-12. The owner decides the wording on `/privacy`; this is what the code does, for them to compare with the "Course videos" and "How well course videos play" rows.

- **Watch history.** A view in a chat message is recorded exactly like a view on the lesson page: where the member stopped, which parts they watched, speed, captions, whether the tab was in view, device and browser (`WatchTracker` in `components/courses/LessonPlayer.tsx`, `/api/courses/watch`), for a member's open lessons and not in sudo. The one addition is `video_watch_segments.chat_message_id`: which chat message it was watched in, so the course stats can keep chat views apart. `/privacy` says course viewing is recorded "to pick up where you left off, and to learn which lessons work"; it does not mention that a view can be tied to a chat message. Like lesson viewing, it is not behind the "leave me out of statistics" switch (that switch covers the usage log, `lib/analytics/opt-out.ts`). Whether to say so is the owner's call; adding "and, for a video shared in chat, which message it was in" to the Course videos row would make it complete.
- **Playback quality.** The chat player is given no `muxData`, so nothing about how a chat video plays goes to the video provider's quality measurement, switch or not (`components/chat/ChatVideo.tsx`; the lesson page passes it only where usage statistics are on).
- **Usage log.** Pressing the card is one click event (`data-track="chat-video-open"`) in the usage log, which the switch does cover.
- **Who sees it.** Admins, in the course watch stats, kept apart from the lesson's own views. Other members see only the card (the lesson's title and its course), never who watched.
- **Slack.** The author's own connected Slack account edits their message to add the links back to the Hub (`rewriteInSlack`); the Hub never posts or edits as anyone else.
- **Third parties.** Nothing a member writes or watches goes anywhere new: the video provider already serves the lesson videos, and no AI service is involved in any of it.

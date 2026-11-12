# Lesson videos in chat: what to publish when the flag goes on

`chat_videos` (`lib/features.ts`) is off for everyone, so nothing member-facing about it is published yet: a changelog entry or a help article now would describe something members cannot use (`.claude/rules/changelog-writing.md`: a flagged feature ships the day the flag goes on for everyone). The engineering entry (`lesson-videos-in-chat-building-blocks`) is already in `lib/changelog/entries.ts`. This file holds the rest, written and checked against the code on 2026-11-11, so it can be published in one small PR on the day.

## The day the flag goes on for everyone

1. Read the day from the production audit log (read-only): `audit_log` rows with `entity_type = 'feature_flag'` where `enabled_globally` goes true. Date the entry with it.
2. Add the product entry below to `lib/changelog/entries.ts` (with `major: false`: it is a feature inside Chat, not a new area) and run the member reader review (`.claude/skills/member-reader-review`) on the copy.
3. Add the help article as `help/share-a-lesson-video-in-chat.md`, with a demo scene for its screenshots (`docs/DEMO_AND_HELP.md`, how to add an article), and look at every image before committing.
4. Take the changelog screenshot with a `@changelog` scene (`pnpm changelog:capture <slug>`), from the demo community only.
5. Check `/privacy` (below) before the flag goes wide.
6. Add `chat_videos` to `LIVE_FLAGS` (`lib/changelog/live-flags.ts`) so the drafter stops holding PRs that name it.

## Product entry (draft)

```ts
{
  slug: "lesson-videos-in-chat",
  date: "<the day the flag went on>",
  audience: "product",
  category: "new",
  title: "Watch a course lesson right in a chat message",
  summary: "Share a lesson's video in any conversation and everyone who has the course can watch it right there, without leaving Chat.",
  body: [
    "A lesson's video can now sit inside a chat message, as a card you press once to play. It works in channels, threads and direct messages.",
    "- On a lesson, choose **Share this video in chat**, or **Copy link to paste in chat** and paste it into any message, in Hub Chat or in Slack.",
    "- The card shows the lesson, its course and its picture. If you have the course, it plays in the message and keeps your place.",
    "- If you don't have the course, the card says so and nothing plays.",
    "- Staff can open a share to everyone in the conversation, for a lesson that is open to members.",
    "- In Slack, the message says what was shared and links to watch it in Hub Chat or open the lesson.",
    "- Deleting the message ends the share right away.",
    "What you watch counts like watching the lesson, so your teachers can see which videos help. A staff member previewing as a member is not counted.",
  ].join("\n"),
},
```

Facts behind each line, so the reviewer can check them: the buttons are in `app/(member)/courses/ShareLessonInChat.tsx`; the card and one-click play are `components/chat/ChatVideo.tsx`; "without the course" is `mayWatchSharedVideo` (`lib/chat/video-access.ts`); the open-to-everyone share is admin-only and only for an open lesson of a published course; the Slack lines are `rewriteInSlack` (`lib/chat/slack-lesson-links.ts`); deleting is the policy and repository change in `20270627000000`; counting is `video_watch_segments` with `chat_message_id`, recorded only for a member's open lessons and not in sudo (`app/api/chat/videos/[messageId]/route.ts`). "Keeps your place" holds for a member who has the course. Do not add a claim about who can see what beyond this without checking it.

## Help article (draft, `help/share-a-lesson-video-in-chat.md`)

```md
# Share a lesson video in chat

Found a lesson that would help someone? Put its video in a conversation, and anyone who has the course can watch it right there.

## Share it from the lesson

Open the lesson and choose **Share this video in chat**. Pick the conversation, add a few words if you like, and send.

![The share box on a lesson](img:share-a-lesson-video-in-chat/01-share-box.png)

## Or paste a link

Choose **Copy link to paste in chat** on the lesson, then paste it into any message: a channel, a thread, a direct message, or Slack. The link turns into the video.

## Watching it

Press the picture and it plays in the message, where you left off. You need the course to watch. If you don't have it, the card says so.

![A shared video in a message](img:share-a-lesson-video-in-chat/02-video-card.png)

## In Slack

Slack can't play the video, so the message there says what was shared and links to **Watch it in Hub Chat** and **Open the lesson**.

## Changed your mind?

Delete the message and the video is gone from the conversation right away.
```

## Check `/privacy` before the flag goes wide

The owner decides the wording on `/privacy`; this is what the code does, for them to compare: a chat view is recorded like a lesson view (position and watched stretches, `video_watch_segments`, tagged with the chat message) for a member's open lessons, not in sudo; staff see it in the course stats, kept apart from the lesson's own views; the Slack message is rewritten with a link back to the Hub by the author's own connected Slack account. Nothing here sends what a member writes or watches to a third party beyond Mux, which already serves the lesson videos. Whether chat views respect the usage-statistics switch on `/privacy` the way lesson views do has not been checked; find out before publishing, and say nothing about it until then. Verify each of the other points again against the code when publishing, since the code can have changed.

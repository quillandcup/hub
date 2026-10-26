/**
 * The narration for the two overview videos, one line per beat (what is on screen for each is in
 * docs/OVERVIEW_VIDEO_SCRIPT.md). The recording speaks these lines (voiceover.ts) and paces what happens on screen
 * to them, so editing a line here and re-recording is the whole change. The same words are the captions.
 *
 * Written for two people at once: someone new, asking "what is this, and why would I join?", and a member who
 * already lives in Slack and Kajabi, asking "what is in it for me?". Every claim is something the screen shows.
 * Spelled for the ear ("Quill and Cup", not "Quill & Cup"), and worded so no word can be read two ways: the speech
 * model read "lives" as the noun ("two lives") where the verb was meant, so the line says "is" instead.
 */

/** About 2.5 minutes. */
export const LONG = {
  hook: "Writing is a solitary act. But it doesn't have to feel lonely.",
  meet: "Meet Hedgie Hub, your home base at Quill and Cup. Everything you need to keep writing, in one place.",
  upcoming: "Open it, and you'll see what's coming up: the Prickles on the schedule, who's hosting, and who's joining you.",
  prickles: "A Prickle is a focused writing sprint with fellow Hedgies, all day, every day. Add any one to your own calendar with a single click.",
  commit: "Or commit to the times that fit your week, and sync your whole schedule once.",
  googleWeek: "Google, Apple, or Outlook will show every Prickle on your calendar,",
  googleEvent: "complete with the Zoom link, and a reminder before it starts.",
  history: "Afterward, check in and out to reflect on how it went. See your month at a glance, or zoom into any week.",
  streaks: "Show up week after week, and watch your streak grow. Your community cheers you on.",
  projects: "Every project is in one place, from first idea to finished draft.",
  log: "After a session, log your words in seconds, and watch your progress build.",
  chat: "And now, chat is right here in the Hub, so the conversation is always one click away.",
  unread: "See what you've missed, and catch up in a moment.",
  thread: "Follow a conversation in its thread, with reactions along the way.",
  post: "Join in right from the Hub. Your message reaches Slack too.",
  search: "And everything is searchable, so no good advice is ever lost.",
  members: "Meet your fellow Hedgies: what they're writing, and what they love to talk about.",
  reminders: "The Hub meets you where you already are, with gentle reminders in Slack, email, or on your phone. You choose.",
  help: "And if you ever get stuck, Hedgie Help has step-by-step guides.",
  close: "Show up. Write. Celebrate. Repeat. Welcome to the Hedgie House.",
} as const;

/** About 30 seconds. */
export const SHORT = {
  hook: "Writing alone is hard. Writing together is better.",
  meet: "Hedgie Hub is your home for writing with a community.",
  commit: "Commit to Prickles, our focused writing sprints, and sync them to your calendar.",
  streaks: "Show up, and watch your streak grow.",
  log: "Log your words, and watch your book take shape.",
  chat: "Chat with fellow writers, right in the Hub.",
  close: "Join us in the Hedgie House.",
} as const;

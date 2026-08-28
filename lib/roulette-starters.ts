// Conversation-starter prompts for Wheel of Wonder matches — writing-
// community-flavored, open-ended, low-pressure, in a warm/personal voice
// ("lovely", "friend") so two matched hedgies aren't staring at a blank
// room with nothing to say.

export const CONVERSATION_STARTERS: string[] = [
  "What are you working on nowadays, lovely?",
  "What's got your attention in your writing world these days?",
  "Coffee, tea, or something else while you write?",
  "What got you into writing in the first place?",
  "Any book lately that you can't stop thinking about?",
  "Are you a plotter or a pantser, friend?",
  "What's one writing goal you're chasing this month?",
  "If your current project were a movie, who'd you cast?",
  "What's the trickiest scene you've had to wrangle lately?",
  "Music while you write, or do you need the quiet?",
  "Any genre you've never tried but always wanted to?",
  "What's your favorite prickle you've ever shown up to, and why?",
  "Any little rituals before you sit down to write?",
  "What's a story you'd tell if you knew it couldn't fail?",
  "Which writer — living, dead, or fictional — would you love to have coffee with?",
  "What's the last thing that made you laugh out loud mid-draft?",
  "Word count goals or scene goals — what's your style?",
  "What's one piece of writing advice that's stuck with you?",
  "Working on something you can talk about, or is it still under wraps?",
  "What does your dream writing spot look like?",
];

/** Picks one starter at random. rng is injectable for deterministic tests. */
export function pickConversationStarter(rng: () => number = Math.random): string {
  return CONVERSATION_STARTERS[Math.floor(rng() * CONVERSATION_STARTERS.length)];
}

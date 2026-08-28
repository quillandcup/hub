// Conversation-starter prompts for Hedgie Roulette matches — writing-
// community-flavored, open-ended, low-pressure. Picked randomly so two
// matched hedgies aren't staring at a blank room with nothing to say.

export const CONVERSATION_STARTERS: string[] = [
  "What are you working on right now — anything you're excited (or stuck) on?",
  "What's your favorite prickle time slot, and why?",
  "Coffee, tea, or something else while you write?",
  "What got you into writing in the first place?",
  "Any book you've read recently that you can't stop thinking about?",
  "Are you a plotter or a pantser?",
  "What's one writing goal you're chasing this month?",
  "If your current project were a movie, who'd you cast?",
  "What's the hardest scene you've ever had to write?",
  "Do you listen to music while you write, or do you need silence?",
  "What's a genre you've never written but always wanted to try?",
  "What's your favorite prickle you've ever attended, and what made it great?",
  "Any writing rituals (or superstitions) before you sit down to write?",
  "What's a story you'd tell if you knew it couldn't fail?",
  "Who's a writer — living, dead, or fictional — you'd love to grab coffee with?",
  "What's the last thing that made you laugh out loud while writing?",
  "Word count goals or scene goals — which do you prefer?",
  "What's one piece of writing advice that's stuck with you?",
  "Are you working on something you can talk about, or is it top secret for now?",
  "What's your ideal writing environment — coffee shop, quiet room, somewhere weirder?",
];

/** Picks one starter at random. rng is injectable for deterministic tests. */
export function pickConversationStarter(rng: () => number = Math.random): string {
  return CONVERSATION_STARTERS[Math.floor(rng() * CONVERSATION_STARTERS.length)];
}

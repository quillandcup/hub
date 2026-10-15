import type { ReactionEmojiValue } from "@/lib/slack-reaction-emoji";

/**
 * A Slack reaction on an activity row: the resolved Unicode emoji or custom image (the server puts it
 * in `data.reaction_emoji`, see lib/slack-reaction-emoji.ts), else the `:name:` as typed.
 */
export default function ReactionEmoji({ name, emoji }: { name: string; emoji?: ReactionEmojiValue | null }) {
  if (emoji && "url" in emoji) {
    // eslint-disable-next-line @next/next/no-img-element -- small remote Slack emoji images; no sizing to optimise
    return <img src={emoji.url} alt={`:${name}:`} title={`:${name}:`} className="inline-block h-[1.25em] w-[1.25em] align-text-bottom" />;
  }
  if (emoji && "text" in emoji) return <span title={`:${name}:`}>{emoji.text}</span>;
  return <span>:{name}:</span>;
}

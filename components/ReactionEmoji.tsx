import EmojiImage from "@/components/EmojiImage";
import type { ReactionEmojiValue } from "@/lib/slack-reaction-emoji";

/**
 * A Slack reaction on an activity row: the resolved Unicode emoji or custom image (the server puts it
 * in `data.reaction_emoji`, see lib/slack-reaction-emoji.ts), else the `:name:` as typed.
 */
export default function ReactionEmoji({ name, emoji }: { name: string; emoji?: ReactionEmojiValue | null }) {
  if (emoji && "url" in emoji) {
    return <EmojiImage name={name} url={emoji.url} still={"still" in emoji ? emoji.still : undefined} stored={"stored" in emoji ? emoji.stored : undefined} />;
  }
  if (emoji && "text" in emoji) return <span title={`:${name}:`}>{emoji.text}</span>;
  return <span>:{name}:</span>;
}

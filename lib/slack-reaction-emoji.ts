import { customEmojiFor } from "@/lib/chat/names";
import { unicodeEmoji, type CustomEmoji } from "@/lib/chat/emoji";
import { reactionName, type ReactionRow } from "@/lib/activity-feed";

/**
 * What a reaction on a Slack activity row looks like: a Unicode emoji or the workspace's custom
 * image. Resolved on the server because the standard-emoji dataset is large; the browser gets only
 * the result, as `data.reaction_emoji` (see components/ReactionEmoji.tsx). Absent when the name is
 * neither custom nor standard, so the UI shows `:name:` as typed.
 */
export type ReactionEmojiValue = CustomEmoji;

type ActivityLike = ReactionRow;

/** Rows with each Slack reaction's emoji resolved into `data.reaction_emoji`; other rows are untouched. */
export async function withReactionEmoji<T extends ActivityLike>(rows: T[]): Promise<T[]> {
  const names = rows.map(reactionName).filter((n): n is string => !!n);
  if (names.length === 0) return rows;
  const custom = await customEmojiFor(names);
  return rows.map((row) => {
    const name = reactionName(row);
    if (!name) return row;
    const emoji: ReactionEmojiValue | null = custom[name] ?? custom[name.toLowerCase()] ?? standard(name);
    return emoji ? { ...row, data: { ...(row.data ?? {}), reaction_emoji: emoji } } : row;
  });
}

function standard(name: string): ReactionEmojiValue | null {
  const text = unicodeEmoji(name);
  return text ? { text } : null;
}

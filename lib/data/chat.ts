import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A stored row, as the database has it, with only the named columns required: a test or seed names just what it cares about. */
type Seed<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

/** The chat rows as the in-memory dataset keeps them. */
export type ChatChannelSeed = Seed<Row<"chat_channels">, "id">;
export type ChatChannelMemberSeed = Seed<Row<"chat_channel_members">, "channel_id" | "member_id">;
export type ChatMessageSeed = Seed<Row<"chat_messages">, "id" | "channel_id">;
export type ChatMessageContentSeed = Seed<Row<"chat_message_contents">, "message_id">;
export type ChatReactionSeed = Seed<Row<"chat_reactions">, "message_id">;
export type ChatSlackAuthorSeed = Seed<Row<"chat_slack_authors">, "slack_user_id" | "member_id">;
export type ChatGapFillSeed = Seed<Row<"chat_gap_fills">, "id">;

/** How a channel is wired to Slack: whether the Hub mirrors it, whether that is switched off, and its health. */
export interface BridgeState {
  bridge_mode: string;
  bridge_disabled: boolean;
  bridge_status: string;
}

/**
 * Chat: the Hub's mirror of bridged Slack conversations and what members do in it. The repository
 * takes whichever client the caller has, so the privilege is the client's: message text sits in its own
 * table (`chat_message_contents`) that RLS hides per channel, and reads of it stay on the client they
 * use today. This is the skeleton; the channel, membership, message, content, author and gap-fill
 * methods are added by slice, each in its own labelled section. Every method throws on a database error.
 */
export interface ChatRepository {
  /** A channel's Slack bridge settings, or null when there is no such channel (or it isn't visible to the caller). */
  bridgeState(channelId: string): Promise<BridgeState | null>;
  /** The Hub id of the channel that mirrors this Slack channel, or null when none does. */
  idBySlackChannel(slackChannelId: string): Promise<string | null>;
}

export class SupabaseChatRepository implements ChatRepository {
  constructor(private readonly db: Db) {}

  async bridgeState(channelId: string) {
    const { data, error } = await this.db.from("chat_channels").select("bridge_mode, bridge_disabled, bridge_status").eq("id", channelId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async idBySlackChannel(slackChannelId: string) {
    const { data, error } = await this.db.from("chat_channels").select("id").eq("slack_channel_id", slackChannelId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryChatRepository implements ChatRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async bridgeState(channelId: string) {
    const c = this.data.chatChannels.find((x) => x.id === channelId);
    // The column defaults, as the database fills them in.
    return c ? { bridge_mode: c.bridge_mode ?? "bridged", bridge_disabled: c.bridge_disabled ?? false, bridge_status: c.bridge_status ?? "ok" } : null;
  }

  async idBySlackChannel(slackChannelId: string) {
    return this.data.chatChannels.find((c) => c.slack_channel_id === slackChannelId)?.id ?? null;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The port between chat core and a transport (docs/architecture/CHAT_MODULE.md). Core (messages, channels, reactions, files, rich text,
 * previews, unread, notifications) asks a transport for everything that has to happen outside the Hub: delivering a message, changing or
 * removing one, reacting, keeping read state in step, pulling conversations the Hub did not write, opening a direct conversation.
 * Slack is the one transport today (`src/modules/chat/slack`); a vendor thread or a second community's chat would be another.
 *
 * Core depends on this file alone: no transport's ids, tokens, formatting or client. Every method must be safe to call when its
 * transport has nothing to do (message not delivered yet, member not connected, not production): it answers "skipped", `false` or
 * `{ ok: true }`, and does not throw for a normal refusal. Methods take the service-role client because they read and record delivery
 * state (`chat_messages` sync status) through the repositories; none of them returns a transport's own id to the caller.
 */

/** What delivering one stored message came to: `skipped` is "nothing to do or not allowed here", `failed` leaves it retryable. */
export type DeliveryResult = "sent" | "skipped" | "failed";

/**
 * What a transport answers when asked to send one stored message. The transport does the sending and never writes the outcome: core
 * records it (`src/lib/chat/delivery.ts`). `sent` without a `ref` means "delivered, but its reference isn't known yet", which leaves the
 * message pending until the transport's own event links it. `via` says how it went out (the member's own link or the app's), for the record.
 */
export type SendOutcome = { status: "sent"; ref?: string; via?: "user_token" | "bot" } | { status: "skipped" } | { status: "failed" };

/** What a change to who is in a conversation came to. `reconnect` means the member's own link failed and the transport acted for them instead: tell them. */
export type MembershipChange = { result: { ok: true } | { ok: false; error: string }; reconnect: boolean };

/** The outcome of changing a message already delivered. `error` is plain words for the author; `code` is for logs and alerts only. */
export type TransportWriteResult = { ok: true; fileIds?: string[] } | { ok: false; error: string; code?: string };

/** What removing one link preview from a delivered message came to. */
export type PreviewRemoval = "updated" | "not_needed" | "failed";

/** Opening a conversation with another member through the transport (the Hub shows it as a direct conversation). */
export type OpenConversationResult =
  | { ok: true; channelId: string }
  | { ok: false; reason: "not_production" | "not_connected" | "unknown_person" | "refused" };

export interface EditMessageArgs {
  messageId: string;
  memberId: string;
  body: string;
  dropPreviews?: boolean;
  keepFileIds?: string[];
  addFiles?: { existingIds: string[]; uploads: { file: Buffer; filename: string }[] };
}

export interface ChatTransport {
  /** A short stable name ("slack"), for logs and for telling transports apart. */
  readonly id: string;

  /** Whether this deployment may write to the real external system (production only for Slack). Reads and pulls are separate. */
  writesEnabled(): boolean;
  /** Whether the member has a working link to the transport, which is what lets them write through it. */
  isConnected(db: SupabaseClient, memberId: string): Promise<boolean>;

  /** Outbound: send a stored message. Returns how it went; core records it and handles retries. */
  send(db: SupabaseClient, messageId: string): Promise<SendOutcome>;
  /** Mirror one member's reaction. Returns whether the transport now agrees. */
  syncReaction(db: SupabaseClient, opts: { messageId: string; memberId: string; emoji: string; active: boolean }): Promise<boolean>;
  editMessage(db: SupabaseClient, opts: EditMessageArgs): Promise<TransportWriteResult>;
  deleteMessage(db: SupabaseClient, opts: { messageId: string; memberId: string }): Promise<TransportWriteResult>;
  deleteFile(db: SupabaseClient, opts: { messageId: string; memberId: string; fileId: string }): Promise<TransportWriteResult>;
  /** Stop a delivered message from showing one link preview in the transport. */
  removePreview(db: SupabaseClient, opts: { messageId: string; memberId: string; key: string }): Promise<PreviewRemoval>;
  /** Files added to a delivered message, already in hand: keep them as the permanent copies so the Hub never asks the transport for its own upload. */
  keepFileCopies(
    db: SupabaseClient,
    opts: { messageId: string; sent: unknown[]; staged: unknown[]; bytes: Map<string, Buffer> }
  ): Promise<void>;

  /** Read state, both ways. Each returns whether the transport was updated or checked. */
  pushRead(db: SupabaseClient, opts: { memberId: string; channelId: string; through: string }): Promise<boolean>;
  pushUnread(db: SupabaseClient, opts: { memberId: string; channelId: string; messageId: string; marker: string }): Promise<boolean>;
  pullRead(db: SupabaseClient, memberId: string, opts?: { exceptChannelId?: string | null }): Promise<boolean>;

  /** The transport's own ids for these members (those it can name, for mentions and invites). */
  externalIdsFor(db: SupabaseClient, memberIds: string[]): Promise<Map<string, string>>;
  /**
   * Put members in a conversation. `channelRef` is the transport's reference for it. The member acting is the one it is done as when
   * their own link works (`selfJoin`: they are joining themselves, not inviting others). `externalUserIds` are from `externalIdsFor`.
   */
  addToConversation(db: SupabaseClient, opts: { actorMemberId: string; channelRef: string; externalUserIds: string[]; selfJoin: boolean }): Promise<MembershipChange>;
  /** Take one person out: the acting member leaving (`self`) or removing someone else. */
  removeFromConversation(db: SupabaseClient, opts: { actorMemberId: string; channelRef: string; externalUserId: string; self: boolean }): Promise<MembershipChange>;
  /** Replace a message the app itself posted (a check-in with controls) with a new body, as the app. Throws when it cannot. */
  updateAppMessage(opts: { channelRef: string; ref: string; message: Record<string, unknown> }): Promise<void>;

  /** Bring one conversation up to date with the transport when the Hub opens it (what the transport holds that the chat doesn't yet). `channelRef` is the transport's reference. */
  catchUp(db: SupabaseClient, opts: { channelRef: string }): Promise<void>;

  /** Pull the member's direct conversations that were written outside the Hub. Resolves when done; the result is for the nightly run's report. */
  pullDirectConversations(db: SupabaseClient, memberId: string): Promise<unknown>;
  openDirectConversation(db: SupabaseClient, memberId: string, otherMemberId: string): Promise<OpenConversationResult>;
}

/**
 * What a transport reports to core when something happens on its side: a message written there, an edit, a deletion or a reaction. The
 * transport decodes and verifies its events and keeps its own raw copy (Slack's Bronze tables); it then asks core to bring the chat in line
 * (`messageChanged`) and, for a new message, to tell the people who should hear (`messageArrived`). Core owns what that means: the projection
 * into chat messages and the notifications. References are the transport's own (`channelRef`, `ref`), never its event shape.
 */
export interface InboundEvent {
  transport: string;
  channelRef: string;
  ref: string;
  kind: "message" | "edit" | "delete" | "reaction";
}

export interface ChatInboundSink {
  /** The chat copy of one message is brought in line with what the transport stored. `present` is whether the chat has that message afterwards. Idempotent: the same event twice, or out of order, ends in the same state. */
  messageChanged(db: SupabaseClient, event: InboundEvent): Promise<{ present: boolean }>;
  /** A new message is in the chat: notify the people it concerns. Call after the transport's own touch-ups, so nobody is told before the message is final. */
  messageArrived(db: SupabaseClient, event: Omit<InboundEvent, "kind">): Promise<void>;
}

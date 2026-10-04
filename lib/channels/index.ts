import type { ChannelId } from "./catalog";
import type { ChannelAdapter } from "./types";
import { slackChannel } from "./slack";
import { inAppChannel } from "./in-app";

export { CHANNELS, isChannelId, type ChannelId } from "./catalog";
export type { ChannelAdapter, OutboundMessage, SendContext, TimeWindow } from "./types";

/** Adding a channel: add it to CHANNELS (catalog.ts), implement its adapter, register it here. */
export const CHANNEL_ADAPTERS: Record<ChannelId, ChannelAdapter> = {
  slack: slackChannel,
  in_app: inAppChannel,
};

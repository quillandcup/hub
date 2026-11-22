import type { ChatTransport } from "@/lib/chat/transport";
import { installedChatTransports } from "@/modules/chat-transport";

/** Used when no transport is installed: every call is a polite no-op, so chat works as Hub-only conversations. */
export const NO_TRANSPORT: ChatTransport = {
  id: "none",
  writesEnabled: () => false,
  isConnected: async () => false,
  deliver: async () => "skipped",
  retryUnsent: async () => ({ sent: 0, failed: 0, expired: 0 }),
  syncReaction: async () => false,
  editMessage: async () => ({ ok: true }),
  deleteMessage: async () => ({ ok: true }),
  deleteFile: async () => ({ ok: true }),
  removePreview: async () => "not_needed",
  keepFileCopies: async () => {},
  pushRead: async () => false,
  pushUnread: async () => false,
  pullRead: async () => false,
  pullDirectConversations: async () => null,
  openDirectConversation: async () => ({ ok: false, reason: "not_connected" }),
};

/**
 * One transport per deployment today (the first installed). Taking a list keeps the choice in one place for the day a deployment needs
 * several (a thread per tenant): that is a routing decision for core, not something a transport knows.
 */
export function createChatTransportRegistry(installed: readonly ChatTransport[]): { transport(): ChatTransport } {
  const ids = installed.map((t) => t.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Two chat transports are both named "${duplicate}".`);
  return { transport: () => installed[0] ?? NO_TRANSPORT };
}

const registry = createChatTransportRegistry(installedChatTransports);

/** The transport chat core talks to. */
export const chatTransport = (): ChatTransport => registry.transport();

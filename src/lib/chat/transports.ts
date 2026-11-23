import type { ChatTransport } from "@/lib/chat/transport";
import { installedChatTransports } from "@/modules/chat-transport";

/** Used when no transport is installed: every call is a polite no-op, so chat works as Hub-only conversations. */
export const NO_TRANSPORT: ChatTransport = {
  id: "none",
  writesEnabled: () => false,
  requiresLink: () => false,
  hasFullLink: async () => false,
  isConnected: async () => false,
  send: async () => ({ status: "skipped" }),
  syncReaction: async () => false,
  editMessage: async () => ({ ok: true }),
  deleteMessage: async () => ({ ok: true }),
  deleteFile: async () => ({ ok: true }),
  removePreview: async () => "not_needed",
  messageLink: () => null,
  bodyFromBlocks: () => null,
  fetchFile: async () => ({ ok: false, reason: "no chat transport installed" }),
  keepFileCopies: async () => {},
  pushRead: async () => false,
  pushUnread: async () => false,
  pullRead: async () => false,
  externalIdsFor: async () => new Map(),
  addToConversation: async () => ({ result: { ok: false, error: "Chat isn't connected to anything that can add people." }, reconnect: false }),
  removeFromConversation: async () => ({ result: { ok: false, error: "Chat isn't connected to anything that can remove people." }, reconnect: false }),
  updateAppMessage: async () => {
    throw new Error("no chat transport installed");
  },
  catchUp: async () => {},
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

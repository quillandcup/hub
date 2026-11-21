import type { ChatTextContext } from "@/components/chat/ChatText";

/** What a list knows about names and links, plus what a newer fetch found (the newer wins). */
export function mergeChatContext(a: ChatTextContext, b: ChatTextContext): ChatTextContext {
  return {
    userNames: { ...a.userNames, ...b.userNames },
    userMembers: { ...a.userMembers, ...b.userMembers },
    channelIds: { ...a.channelIds, ...b.channelIds },
    channelNames: { ...a.channelNames, ...b.channelNames },
    customEmoji: { ...a.customEmoji, ...b.customEmoji },
  };
}

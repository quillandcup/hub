import type { ChatTransport } from "@/lib/chat/transport";
import { slackTransport } from "./chat/slack";

/**
 * The chat composition root: the one place that names which transports are installed for chat (static import, no discovery). Chat core
 * builds its transport from this list (`src/lib/chat/transports.ts`) and imports nothing from a transport. To run chat with no Slack,
 * remove the line: sends stay pending, reactions stay Hub-only, nothing throws. See docs/architecture/CHAT_MODULE.md.
 */
export const installedChatTransports: readonly ChatTransport[] = [slackTransport];

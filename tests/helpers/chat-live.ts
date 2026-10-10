import { vi } from "vitest";

/**
 * Stand-ins for the browser-side Realtime pieces the chat sidebar and ChatLive use, for page tests
 * that render them but have no Supabase client: `vi.mock("@/lib/chat/live", () =>
 * import("@/tests/helpers/chat-live").then((m) => m.chatLiveModule))` and the same for
 * `@/lib/supabase/client` with `supabaseClientModule`.
 */
const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn(() => channel),
  subscribe: vi.fn(() => channel),
};

export const chatLiveModule = { authenticateRealtime: vi.fn(async () => {}) };
export const supabaseClientModule = { createClient: () => ({ channel: () => channel, removeChannel: vi.fn() }) };

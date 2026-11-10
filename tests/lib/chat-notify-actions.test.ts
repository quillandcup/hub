import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureServerEntryExports } from "next/dist/build/webpack/loaders/next-flight-loader/action-validate";

const m = vi.hoisted(() => ({ caller: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/analytics/server", () => ({
  withAction: async (_name: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("@/lib/chat/caller", () => ({ chatCaller: m.caller }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));

import * as actions from "@/app/(member)/chat/notify-actions";

const CHANNEL = "chn_AAAAAAAAAAC1";

beforeEach(() => {
  vi.clearAllMocks();
  m.caller.mockResolvedValue({ identity: { isSudo: false } });
  m.rpc.mockResolvedValue({ error: null });
});

describe("chat notification actions", () => {
  it("passes Next.js's runtime export validation when the chat action bundle loads", () => {
    // A non-function export here breaks every action on the chat page, including sending and deleting.
    expect(() => ensureServerEntryExports(Object.values(actions))).not.toThrow();
  });

  it.each(["default", "all", "mentions", "nothing"] as const)("saves the %s setting", async (setting) => {
    expect(await actions.setChatNotifySetting(CHANNEL, setting)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("chat_set_notify_setting", { p_channel_id: CHANNEL, p_setting: setting });
  });

  it("rejects an invalid setting before calling the database", async () => {
    expect(await actions.setChatNotifySetting(CHANNEL, "invalid" as never)).toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses changes in sudo mode", async () => {
    m.caller.mockResolvedValue({ identity: { isSudo: true } });
    expect(await actions.setChatNotifySetting(CHANNEL, "all")).toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

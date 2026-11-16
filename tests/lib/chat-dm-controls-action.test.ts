import { describe, it, expect, vi } from "vitest";

const caller = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/caller", () => ({ postingCaller: caller }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_a: string, run: () => Promise<unknown>) => run() }));
const pressed = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, unfurl: null })));
vi.mock("@/lib/chat/dm-controls-press", () => ({ pressDmControl: pressed }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({}) }));
const chatUpdate = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/slack-client", () => ({ createSlackClient: () => ({ chat: { update: chatUpdate } }) }));
const token = vi.hoisted(() => vi.fn(async () => "xoxb-test"));
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: token }));

import { pressChatDmControl } from "@/app/(member)/chat/dm-controls-actions";

const press = { channelId: "chn_AAAAAAAAAAA1", messageId: "msg_AAAAAAAAAAA1", blockId: "b", actionId: "prickle_submit" };

describe("pressChatDmControl", () => {
  it("does nothing for a signed-out visitor or someone acting as a member (no posting caller)", async () => {
    caller.mockResolvedValue(null);
    expect(await pressChatDmControl(press)).toMatchObject({ ok: false });
    expect(pressed).not.toHaveBeenCalled();
  });

  it("uses the signed-in member's id, never one from the request, and updates Slack as the bot", async () => {
    caller.mockResolvedValue({ userId: "u", identity: { memberId: "mbr_AAAAAAAAAAA1", isSudo: false } });
    await pressChatDmControl({ ...press, memberId: "mbr_AAAAAAAAAAA2" } as never);
    const deps = (pressed.mock.calls[0] as unknown as [{ memberId: string; updateSlack: (c: string, t: string, m: object) => Promise<void> }])[0];
    expect(deps.memberId).toBe("mbr_AAAAAAAAAAA1");
    await deps.updateSlack("D1", "1.1", { text: "t", blocks: [] });
    expect(chatUpdate).toHaveBeenCalledWith({ channel: "D1", ts: "1.1", text: "t", blocks: [] });
    token.mockResolvedValueOnce(null as never);
    await expect(deps.updateSlack("D1", "1.1", { text: "t", blocks: [] })).rejects.toThrow();
  });
});

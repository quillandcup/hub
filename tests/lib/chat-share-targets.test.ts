import { describe, expect, it, vi } from "vitest";

const { channels } = vi.hoisted(() => ({ channels: [] as unknown[] }));
vi.mock("@/lib/chat/load", () => ({ loadChatChannels: async () => channels }));
import { shareTargets } from "@/lib/chat/share-targets";

const channel = (over: Record<string, unknown>) => ({ id: "chn_AAAAAAAAAAA1", kind: "channel", label: "#writing", archived: false, joined: true, slackChannelId: "C1", ...over });

describe("shareTargets", () => {
  it("lists the open, joined, Slack-bridged channels, and not direct messages, unjoined or archived ones, or a Hub-only channel", async () => {
    channels.splice(
      0,
      channels.length,
      channel({}),
      channel({ id: "chn_AAAAAAAAAAA2", kind: "dm", label: "Ada" }),
      channel({ id: "chn_AAAAAAAAAAA3", kind: "group_dm", label: "Ada, Fern" }),
      channel({ id: "chn_AAAAAAAAAAA4", joined: false }),
      channel({ id: "chn_AAAAAAAAAAA5", archived: true }),
      channel({ id: "chn_AAAAAAAAAAA6", slackChannelId: null }),
    );

    expect(await shareTargets({} as never, "mbr_AAAAAAAAAAA1")).toEqual([{ id: "chn_AAAAAAAAAAA1", label: "#writing" }]);
  });
});

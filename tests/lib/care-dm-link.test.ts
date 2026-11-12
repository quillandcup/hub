import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { dmLinkTarget, resolveDmLinks, slackTeamId } from "@/lib/care-dm-link";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const CHANNEL = "chn_AAAAAAAAAAA1";

afterEach(() => vi.unstubAllEnvs());

describe("dmLinkTarget", () => {
  it("opens the DM in Hub Chat when the Hub has it for the viewer", () => {
    expect(dmLinkTarget({ slackChannelId: "D0TEST001", hubChatChannelId: CHANNEL, slackTeamId: "T0TEST" })).toEqual({ href: `/chat/${CHANNEL}`, kind: "hub_chat" });
  });

  it("falls back to Slack's documented app_redirect with the DM's id, naming the workspace only when it is configured", () => {
    expect(dmLinkTarget({ slackChannelId: "D0TEST001", hubChatChannelId: null })).toEqual({ href: "https://slack.com/app_redirect?channel=D0TEST001", kind: "slack" });
    expect(dmLinkTarget({ slackChannelId: "D0TEST001", hubChatChannelId: null, slackTeamId: "T0TEST" })).toEqual({
      href: "https://slack.com/app_redirect?channel=D0TEST001&team=T0TEST",
      kind: "slack",
    });
  });

  it("never carries anything but ids", () => {
    const { href } = dmLinkTarget({ slackChannelId: "D0TEST001", hubChatChannelId: null, slackTeamId: "T0TEST" });
    expect([...new URL(href).searchParams.keys()].sort()).toEqual(["channel", "team"]);
  });
});

describe("slackTeamId", () => {
  it("is the configured workspace id, or null when there is none", () => {
    vi.stubEnv("SLACK_TEAM_ID", "T0TEST");
    expect(slackTeamId()).toBe("T0TEST");
    vi.stubEnv("SLACK_TEAM_ID", "");
    expect(slackTeamId()).toBeNull();
  });
});

describe("resolveDmLinks", () => {
  const MEMBERS = [
    { id: ME, name: "Me Example", email: "me@example.test" },
    { id: OTHER, name: "Other Example", email: "other@example.test" },
  ];
  const CHANNELS = [
    { id: CHANNEL, slack_channel_id: "D0MINE", kind: "dm", visibility: "private" },
    { id: "chn_AAAAAAAAAAA2", slack_channel_id: "D0THEIRS", kind: "dm", visibility: "private" },
  ];
  const chat = (members: { channel_id: string; member_id: string; left_at?: string | null }[]) =>
    createInMemoryRepos(new InMemoryDataset({ members: MEMBERS, chatChannels: CHANNELS, chatChannelMembers: members.map((m) => ({ source: "slack", left_at: null, ...m })) })).chat;

  it("links to Hub Chat for a DM she is in there, and to Slack for one she is not (or that is not mirrored)", async () => {
    const links = await resolveDmLinks(
      { chat: chat([{ channel_id: CHANNEL, member_id: ME }, { channel_id: "chn_AAAAAAAAAAA2", member_id: OTHER }]), selfMemberId: ME, slackTeamId: "T0TEST" },
      ["D0MINE", "D0THEIRS", "D0UNKNOWN"]
    );

    expect(links.get("D0MINE")).toEqual({ href: `/chat/${CHANNEL}`, kind: "hub_chat" });
    // The conversation exists in the Hub, but she is not in it: she is not sent to a page she cannot read.
    expect(links.get("D0THEIRS")).toEqual({ href: "https://slack.com/app_redirect?channel=D0THEIRS&team=T0TEST", kind: "slack" });
    expect(links.get("D0UNKNOWN")?.kind).toBe("slack");
  });

  it("links to Slack for every DM when the viewer has no member record, and reads nothing for no DMs", async () => {
    const links = await resolveDmLinks({ chat: chat([{ channel_id: CHANNEL, member_id: ME }]), selfMemberId: null }, ["D0MINE"]);
    expect(links.get("D0MINE")?.kind).toBe("slack");
    expect((await resolveDmLinks({ chat: chat([]), selfMemberId: ME }, [])).size).toBe(0);
  });

  it("ignores a Hub conversation she left", async () => {
    const links = await resolveDmLinks({ chat: chat([{ channel_id: CHANNEL, member_id: ME, left_at: "2026-03-01T00:00:00.000Z" }]), selfMemberId: ME }, ["D0MINE"]);
    expect(links.get("D0MINE")?.kind).toBe("slack");
  });
});

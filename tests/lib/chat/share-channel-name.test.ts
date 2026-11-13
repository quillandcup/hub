import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/names", () => ({}));
import { withShareSource } from "@/lib/chat/load";
import { parseSharedMessage } from "@/lib/chat/shared-message";
import type { Unfurl } from "@/lib/chat/unfurls";

// A real share attachment names no channel: its footer is the literal "Slack Conversation" and the channel is only an id.
const real = { is_share: true, is_msg_unfurl: true, text: "quoted", ts: "1700000000.000100", channel_id: "C123ABC", footer: "Slack Conversation", from_url: "https://example.slack.com/archives/C123ABC/p1700000000000100" };
const unfurl = (attachment: Record<string, unknown>) => ({ kind: "share", attachment, removeKey: "url:x" }) as unknown as Extract<Unfurl, { kind: "share" }>;

describe("the channel line of a shared message", () => {
  it("is the Hub's own name for the channel id, never the footer", () => {
    const out = withShareSource(unfurl(real), null, { C123ABC: "cody-test1" });
    expect(out.shared?.channelName).toBe("cody-test1");
    expect(JSON.stringify(out.shared)).not.toContain("Slack Conversation");
  });

  it("is empty when the Hub knows no name for the channel (a private or unknown one)", () => {
    expect(withShareSource(unfurl(real), null, {}).shared?.channelName).toBeNull();
    expect(withShareSource(unfurl(real), null).shared?.channelName).toBeNull();
  });

  it("keeps a name Slack did send", () => {
    expect(withShareSource(unfurl({ ...real, channel_name: "from-slack" }), null, { C123ABC: "other" }).shared?.channelName).toBe("from-slack");
  });

  it("reads the channel id from message_blocks when the attachment has no channel_id", () => {
    const { channel_id: _omit, ...rest } = real;
    void _omit;
    const s = parseSharedMessage({ ...rest, message_blocks: [{ channel: "C999ZZZ", message: { blocks: [] } }] })!;
    expect(s.slackChannelId).toBe("C999ZZZ");
    expect(parseSharedMessage({ ...rest, message_blocks: [{ channel: "bad id" }] })!.slackChannelId).toBeNull();
  });
});

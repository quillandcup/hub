import { describe, expect, it, vi } from "vitest";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { cardLine, NEUTRAL_CARD_TEXT, parseLinkShared, slackCardText, unfurlHubLinks, MAX_UNFURLS, type LinkSharedEvent } from "@/lib/chat/slack-link-unfurl";

const AUTHOR = "mbr_AAAAAAAAAAA1";
const PUBLIC = "chn_AAAAAAAAAAP1";
const PRIVATE = "chn_AAAAAAAAAAP2";
const RESTRICTED = "chn_AAAAAAAAAAP3";
const DM = "chn_AAAAAAAAAAD1";
const GROUP = "chn_AAAAAAAAAAD2";
const MSG = "msg_AAAAAAAAAAA1";
const PRICKLE = "prkl_AAAAAAAAAAA1";

const msg = (id: string, channel: string, over: Record<string, unknown> = {}) => ({ id, channel_id: channel, author_member_id: AUTHOR, origin: "app", created_at: "2026-10-01T15:00:00Z", ...over });

const repos = () =>
  createInMemoryRepos(
    new InMemoryDataset({
      members: [{ id: AUTHOR, name: "Alexandra Legalname", displayName: "Fern <&> *Quillsby*", email: "ada@example.test", photoUrl: "https://photos.example.test/a.jpg", bio: "A private-ish bio" }],
      chatChannels: [
        { id: PUBLIC, name: "general", kind: "channel", visibility: "public" },
        { id: PRIVATE, name: "secret-club", kind: "channel", visibility: "private" },
        { id: RESTRICTED, name: "restricted-room", kind: "channel", visibility: "public", restricted: true },
        { id: DM, kind: "dm", visibility: "private" },
        { id: GROUP, kind: "group_dm", visibility: "private" },
      ],
      chatMessages: [
        msg(MSG, PUBLIC),
        msg("msg_AAAAAAAAAAA2", PRIVATE),
        msg("msg_AAAAAAAAAAA3", RESTRICTED),
        msg("msg_AAAAAAAAAAA4", DM),
        msg("msg_AAAAAAAAAAA5", GROUP),
        msg("msg_AAAAAAAAAAA6", PUBLIC, { deleted_at: "2026-10-02T00:00:00Z" }),
      ] as never,
      chatMessageContents: [{ message_id: MSG, body: "the words of the message must never reach Slack" }] as never,
      prickleTypes: [{ id: "prty_AAAAAAAAAAA1", name: "Sprint Prickle", normalizedName: "sprint prickle", aliases: [], isGuestSpeaker: false } as never],
      prickles: [{ id: PRICKLE, typeId: "prty_AAAAAAAAAAA1", hostId: null, title: null, startTime: "2026-11-01T15:00:00Z", endTime: "2026-11-01T16:00:00Z", source: "calendar", calendarEventId: null }],
    }),
  );

const link = (path: string) => `${APP_URL}${path}`;
const event = (urls: string[], over: Partial<LinkSharedEvent> = {}): LinkSharedEvent => ({ channel: "C1", messageTs: "1700000000.000100", unfurlId: null, source: null, urls, ...over });
const fakeSlack = (response: unknown = { ok: true }) => {
  const unfurl = vi.fn(async (_args: Record<string, unknown>) => response);
  return { slack: { chat: { unfurl } } as never, unfurl };
};

describe("parseLinkShared", () => {
  it("reads the event Slack sends, with the unfurl id and source when it has them", () => {
    expect(parseLinkShared({ type: "link_shared", channel: "C1", message_ts: "1.1", unfurl_id: "U1-abc", source: "composer", links: [{ domain: "hub.example", url: "https://hub.example/x" }, { domain: "x" }] })).toEqual({
      channel: "C1",
      messageTs: "1.1",
      unfurlId: "U1-abc",
      source: "composer",
      urls: ["https://hub.example/x"],
    });
    expect(parseLinkShared({ type: "link_shared", channel: "C1", message_ts: "1.1", links: [], source: "other" })).toMatchObject({ unfurlId: null, source: null });
  });

  it("refuses anything that is not a well-formed link_shared event", () => {
    for (const odd of [null, "x", {}, { type: "message" }, { type: "link_shared", channel: "C1", message_ts: "1.1" }, { type: "link_shared", channel: 5, message_ts: "1.1", links: [] }]) {
      expect(parseLinkShared(odd)).toBeNull();
    }
  });
});

describe("what a card in Slack says (seen by everyone in the conversation)", () => {
  it("names the author and the channel for a message in a public channel, and never its text", async () => {
    const text = await slackCardText(repos(), { kind: "message", channelId: PUBLIC, messageId: MSG }, { descriptive: true });
    expect(text).toBe("A message from Fern <&> *Quillsby* in #general in Hub Chat");
    expect(text).not.toContain("words of the message");
    expect(text).not.toContain("Legalname");
  });

  it("is the neutral card for a private channel, a restricted one, a direct and a group message, and a missing or deleted message", async () => {
    const r = repos();
    for (const [channelId, messageId] of [
      [PRIVATE, "msg_AAAAAAAAAAA2"],
      [RESTRICTED, "msg_AAAAAAAAAAA3"],
      [DM, "msg_AAAAAAAAAAA4"],
      [GROUP, "msg_AAAAAAAAAAA5"],
      [PUBLIC, "msg_AAAAAAAAAAA6"],
      [PUBLIC, "msg_AAAAAAAAAAZ9"],
      ["chn_AAAAAAAAAAZ9", MSG],
      // The message is in another conversation than the link says.
      [PRIVATE, MSG],
    ]) {
      expect(await slackCardText(r, { kind: "message", channelId, messageId }, { descriptive: true }), `${channelId} ${messageId}`).toBe(NEUTRAL_CARD_TEXT);
    }
  });

  it("gives a prickle's title and its start in the organization's zone (15:00 UTC on the day daylight saving ends is 10:00 EST),  and a member's display name and nothing else", async () => {
    const r = repos();
    expect(await slackCardText(r, { kind: "prickle", prickleId: PRICKLE }, { descriptive: true })).toBe("Sunday Sprint Prickle, Sun, Nov 1, 10:00 AM EST");
    expect(await slackCardText(r, { kind: "prickle", prickleId: "prkl_AAAAAAAAAAZ9" }, { descriptive: true })).toBe(NEUTRAL_CARD_TEXT);
    const member = await slackCardText(r, { kind: "member", memberId: AUTHOR }, { descriptive: true });
    expect(member).toBe("Fern <&> *Quillsby* on the Hub");
    expect(member).not.toMatch(/ada@example|private-ish|photos\.example/);
    expect(await slackCardText(r, { kind: "member", memberId: "mbr_AAAAAAAAAAZ9" }, { descriptive: true })).toBe(NEUTRAL_CARD_TEXT);
  });

  it("says only that it is a link to the Hub while the descriptive cards are not switched on", async () => {
    for (const link of [{ kind: "message", channelId: PUBLIC, messageId: MSG }, { kind: "prickle", prickleId: PRICKLE }, { kind: "member", memberId: AUTHOR }] as const) {
      expect(await slackCardText(repos(), link, { descriptive: false })).toBe(NEUTRAL_CARD_TEXT);
    }
  });

  it("falls back to the neutral card when a read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = repos();
    r.chat.channelRecord = async () => {
      throw new Error("database down");
    };
    expect(await slackCardText(r, { kind: "message", channelId: PUBLIC, messageId: MSG }, { descriptive: true })).toBe(NEUTRAL_CARD_TEXT);
    vi.restoreAllMocks();
  });
});

describe("cardLine", () => {
  it("is one short line of text", () => {
    expect(cardLine("a\n\nb\tc\u0007d")).toBe("a b c d");
    expect(cardLine("x".repeat(500))).toHaveLength(300);
  });
});

describe("unfurlHubLinks", () => {
  it("answers by unfurl id and source when Slack gave them, with the text as plain text (so a name cannot add markup) and a link built from the ids", async () => {
    const { slack, unfurl } = fakeSlack();
    const address = link(`/chat/${PUBLIC}?m=${MSG}`);
    const result = await unfurlHubLinks(event([address], { unfurlId: "U1-abc", source: "conversations_history" }), { repos: repos(), slack, descriptive: true });
    expect(result).toEqual({ status: "unfurled", count: 1 });
    expect(unfurl).toHaveBeenCalledTimes(1);
    const args = unfurl.mock.calls[0][0] as { unfurl_id: string; source: string; unfurls: Record<string, { blocks: { type: string; text?: { type: string; text: string }; elements?: { text: string }[] }[] }> };
    expect(args).toMatchObject({ unfurl_id: "U1-abc", source: "conversations_history" });
    expect(args).not.toHaveProperty("channel");
    const blocks = args.unfurls[address].blocks;
    expect(blocks[0].text).toEqual({ type: "plain_text", text: "A message from Fern <&> *Quillsby* in #general in Hub Chat", emoji: false });
    expect(blocks[1].elements?.[0].text).toBe(`<${APP_URL}/chat/${PUBLIC}?m=${MSG}|Open in the Hub>`);
  });

  it("answers by channel and ts otherwise", async () => {
    const { slack, unfurl } = fakeSlack();
    await unfurlHubLinks(event([link(`/prickles/${PRICKLE}`)]), { repos: repos(), slack, descriptive: true });
    expect(unfurl.mock.calls[0][0]).toMatchObject({ channel: "C1", ts: "1700000000.000100" });
  });

  it("gives a neutral card to a Hub page without a card kind, and leaves other hosts alone", async () => {
    const { slack, unfurl } = fakeSlack();
    const hubOnly = link("/courses/some-course");
    await unfurlHubLinks(event([hubOnly, "https://elsewhere.example.test/x", `${APP_URL}.evil.test/prickles/${PRICKLE}`]), { repos: repos(), slack, descriptive: true });
    const unfurls = (unfurl.mock.calls[0][0] as { unfurls: Record<string, { blocks: { text?: { text: string } }[] }> }).unfurls;
    expect(Object.keys(unfurls)).toEqual([hubOnly]);
    expect(unfurls[hubOnly].blocks).toHaveLength(1);
    expect(unfurls[hubOnly].blocks[0].text?.text).toBe(NEUTRAL_CARD_TEXT);
  });

  it("does nothing, and asks Slack nothing, when no link is on the Hub", async () => {
    const { slack, unfurl } = fakeSlack();
    expect(await unfurlHubLinks(event(["https://elsewhere.example.test/x"]), { repos: repos(), slack, descriptive: true })).toEqual({ status: "nothing" });
    expect(unfurl).not.toHaveBeenCalled();
  });

  it("answers at most a few links, once each", async () => {
    const { slack, unfurl } = fakeSlack();
    const urls = Array.from({ length: 9 }, (_, i) => link(`/members/mbr_AAAAAAAAAAA${i + 1}`));
    await unfurlHubLinks(event([...urls, urls[0]]), { repos: repos(), slack, descriptive: true });
    expect(Object.keys((unfurl.mock.calls[0][0] as { unfurls: object }).unfurls)).toHaveLength(MAX_UNFURLS);
  });

  it("reports Slack's error code, never an address, when the answer is refused or throws", async () => {
    const refused = fakeSlack({ ok: false, error: "cannot_unfurl_url" });
    expect(await unfurlHubLinks(event([link(`/prickles/${PRICKLE}`)]), { repos: repos(), slack: refused.slack, descriptive: true })).toEqual({ status: "failed", code: "cannot_unfurl_url" });
    const threw = { chat: { unfurl: vi.fn(async () => Promise.reject(Object.assign(new Error("An API error occurred"), { data: { error: "missing_scope" } }))) } } as never;
    expect(await unfurlHubLinks(event([link(`/prickles/${PRICKLE}`)]), { repos: repos(), slack: threw, descriptive: true })).toEqual({ status: "failed", code: "missing_scope" });
    const odd = { chat: { unfurl: vi.fn(async () => Promise.reject(new Error("socket hang up"))) } } as never;
    expect(await unfurlHubLinks(event([link(`/prickles/${PRICKLE}`)]), { repos: repos(), slack: odd, descriptive: true })).toEqual({ status: "failed", code: "unknown" });
  });
});

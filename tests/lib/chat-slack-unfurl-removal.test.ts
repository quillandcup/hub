import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { update, config, getSlackUserToken, alert } = vi.hoisted(() => ({ update: vi.fn(), config: { isProduction: true }, getSlackUserToken: vi.fn(), alert: vi.fn() }));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    return { chat: { update: (a: unknown) => update(a, token) } };
  }),
}));
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  get isProduction() {
    return config.isProduction;
  },
}));
vi.mock("@/lib/slack-connect", async (original) => ({
  ...(await original<typeof import("@/lib/slack-connect")>()),
  getSlackUserToken: (...args: unknown[]) => getSlackUserToken(...args),
}));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: (...args: unknown[]) => alert(...args) }));

import { InMemoryDataset } from "@/lib/data/in-memory";

import { hubMessageMetadata } from "@/lib/chat/slack-post";
import { removeSlackUnfurl, splitAttachments } from "@/lib/chat/slack-unfurl-removal";
import { shareRemoveKey } from "@/lib/chat/shared-message";
import { normalizeLinkForMatch } from "@/lib/chat/unfurl-dedupe";
import { withLinkPreviews } from "@/lib/chat/link-preview-cards";
import { parseUnfurls } from "@/lib/chat/unfurls";

const MESSAGE = "msg_AAAAAAAAAAD1";
const CHANNEL = "chn_AAAAAAAAAAC1";
const FERN = "mbr_AAAAAAAAAAA1";
const ONE = "https://example.test/one.jpg";
const TWO = "https://example.test/two";

/** What Slack stores for the preview of a pasted link: its own bookkeeping (`id`, image sizes) beside the documented fields. */
const slackCard = (url: string, extra: Record<string, unknown> = {}) => ({ id: 1, from_url: url, original_url: url, title: `Title of ${url}`, title_link: url, service_name: "Example", image_url: "https://example.test/p.png", image_width: 640, image_bytes: 1234, fallback: url, ...extra });

let dataset: InMemoryDataset;
const supabase = { rpc: vi.fn(async () => ({ error: null })) } as never;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

const TS = "1700000000.000100";
/** What Slack holds for the message: the Bronze copy of its payload, already Slack-escaped. */
const SLACK_PAYLOAD = { type: "message", ts: TS, text: "look &amp; see &lt;b&gt; <@U_ADA> <#C_HOSTS|hosts>", blocks: [{ type: "rich_text", elements: [] }] };

function seed(opts: { origin?: string; attachments?: unknown; author?: string; slackTs?: string | null; files?: unknown; previews?: object[]; payload?: unknown } = {}) {
  dataset = new InMemoryDataset({
    slackMessages: "payload" in opts && opts.payload === undefined ? [] : [{ channel_id: "C_HOSTS", message_ts: TS, user_id: "U_FERN", occurred_at: "2023-11-14T22:13:20Z", raw_payload: "payload" in opts ? opts.payload : SLACK_PAYLOAD } as never],
    chatChannels: [{ id: CHANNEL, slack_channel_id: "C_HOSTS" } as never],
    chatMessages: [{ id: MESSAGE, channel_id: CHANNEL, origin: opts.origin ?? "app", author_member_id: opts.author ?? FERN, posted_via: "user_token", slack_ts: opts.slackTs === undefined ? "1700000000.000100" : opts.slackTs, deleted_at: null } as never],
    chatMessageContents: [{ message_id: MESSAGE, body: "look & see", attachments: "attachments" in opts ? opts.attachments : [slackCard(ONE)], files: opts.files ?? null } as never],
    chatLinkPreviews: (opts.previews ?? []) as never,
  });
}
const key = (url: string) => `url:${url}`;
const call = (k = key(ONE)) => removeSlackUnfurl(supabase, { messageId: MESSAGE, memberId: FERN, key: k });

beforeEach(() => {
  config.isProduction = true;
  getSlackUserToken.mockReset().mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  // Slack's own rule, as seen in production: an update that names neither text nor blocks is refused.
  update.mockReset().mockImplementation(async (a: { text?: string; blocks?: unknown[] }) => {
    if (a.text === undefined && !a.blocks) throw { data: { error: "no_text" } };
    return { ok: true };
  });
  alert.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed();
});
afterEach(() => vi.restoreAllMocks());

describe("removeSlackUnfurl", () => {
  it("takes the only preview off the Slack copy with the member's own token, sending the message's own text and blocks back, and tags the update as ours", async () => {
    await expect(call()).resolves.toBe("updated");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      { channel: "C_HOSTS", ts: TS, text: SLACK_PAYLOAD.text, blocks: SLACK_PAYLOAD.blocks, parse: "none", attachments: [], metadata: hubMessageMetadata(MESSAGE) },
      "xoxp-fern"
    );
    expect(alert).not.toHaveBeenCalled();
  });

  it("passes Slack's text through byte for byte: entities, mentions and channel tokens are neither escaped again nor resolved", async () => {
    const text = "a &amp; b &lt;c&gt; &amp;amp; <@U_ADA> <#C_HOSTS|hosts> <!here> <https://example.test/one.jpg|pic>";
    seed({ payload: { ...SLACK_PAYLOAD, text, blocks: undefined } });
    await call();
    expect(update.mock.calls[0][0].text).toBe(text);
  });

  it("sends only the text when the message has no blocks, and only the blocks when it has no text", async () => {
    seed({ payload: { text: "plain" } });
    await call();
    expect(update.mock.calls[0][0]).toMatchObject({ text: "plain" });
    expect(update.mock.calls[0][0]).not.toHaveProperty("blocks");
    seed({ payload: { text: "", blocks: SLACK_PAYLOAD.blocks } });
    await call();
    expect(update.mock.calls[1][0].blocks).toEqual(SLACK_PAYLOAD.blocks);
    expect(update.mock.calls[1][0]).not.toHaveProperty("text");
  });

  it("is what Slack's no_text refusal asks for: a call with no content is rejected by the fake, the corrected one is accepted", async () => {
    await expect(update({ channel: "C", ts: "1", attachments: [] })).rejects.toEqual({ data: { error: "no_text" } });
    await expect(call()).resolves.toBe("updated");
  });

  it("fails cleanly, sending nothing and alerting with a distinct reason, when Bronze has no such message or no content in it", async () => {
    seed({ payload: undefined });
    await expect(call()).resolves.toBe("failed");
    expect(alert).toHaveBeenLastCalledWith(expect.anything(), { type: "slack_unfurl_removal_failed", reason: "no_slack_copy" });
    seed({ payload: { type: "message", ts: TS } });
    await expect(call()).resolves.toBe("failed");
    expect(alert).toHaveBeenLastCalledWith(expect.anything(), { type: "slack_unfurl_removal_failed", reason: "no_slack_content" });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the other previews of the message, with the documented fields only", async () => {
    seed({ attachments: [slackCard(ONE), slackCard(TWO, { color: "36a64f" })] });
    await expect(call()).resolves.toBe("updated");
    const sent = update.mock.calls[0][0].attachments;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from_url: TWO, original_url: TWO, title_link: TWO, color: "36a64f", service_name: "Example" });
    expect(sent[0]).not.toHaveProperty("id");
    expect(sent[0]).not.toHaveProperty("image_width");
    expect(sent[0]).not.toHaveProperty("image_bytes");
  });

  it("matches Slack's card on the address the Hub's own preview ended up at, and on tracking-parameter differences", async () => {
    seed({
      attachments: [slackCard("https://www.example.test/landing/?utm_source=x")],
      previews: [{ message_id: MESSAGE, position: 0, url: ONE, final_url: "https://example.test/landing", kind: "image", status: "ok", title: null, description: null, site_name: null, image_url: ONE, fetched_at: "2026-10-01T00:00:00Z" }],
    });
    await expect(call()).resolves.toBe("updated");
    expect(update.mock.calls[0][0].attachments).toEqual([]);
  });

  it("names the message's files again so the update cannot drop them", async () => {
    seed({ files: [{ id: "F1", name: "a.png", mimetype: "image/png", size: 1 }] });
    await call();
    expect(update.mock.calls[0][0].file_ids).toEqual(["F1"]);
  });

  it("does nothing when Slack has no preview of that link, or the card has no address", async () => {
    await expect(call(key("https://example.test/other"))).resolves.toBe("not_needed");
    await expect(call("idx:0")).resolves.toBe("not_needed");
    seed({ attachments: null });
    await expect(call()).resolves.toBe("not_needed");
    seed({ attachments: [] });
    await expect(call()).resolves.toBe("not_needed");
    expect(update).not.toHaveBeenCalled();
  });

  it("never touches a message written in Slack, one that never reached Slack, a deleted one or someone else's", async () => {
    seed({ origin: "slack" });
    await expect(call()).resolves.toBe("not_needed");
    seed({ slackTs: null });
    await expect(call()).resolves.toBe("not_needed");
    seed({ author: "mbr_AAAAAAAAAAA2" });
    await expect(call()).resolves.toBe("not_needed");
    seed();
    dataset.chatMessages[0].deleted_at = "2026-10-01T00:00:00Z";
    await expect(call()).resolves.toBe("not_needed");
    expect(update).not.toHaveBeenCalled();
    expect(getSlackUserToken).not.toHaveBeenCalled();
  });

  it("does nothing off production, where the Hub never writes to Slack", async () => {
    config.isProduction = false;
    await expect(call()).resolves.toBe("not_needed");
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a failure as failed, alerts staff with Slack's reason, and logs no address", async () => {
    update.mockRejectedValue({ data: { error: "ratelimited" } });
    await expect(call()).resolves.toBe("failed");
    expect(alert).toHaveBeenCalledWith(expect.anything(), { type: "slack_unfurl_removal_failed", reason: "ratelimited" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("example.test");
  });

  it("does not alert staff for a member who has not connected Slack or whose token is dead, but still says failed", async () => {
    getSlackUserToken.mockResolvedValue(null);
    await expect(call()).resolves.toBe("failed");
    getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
    update.mockRejectedValue({ data: { error: "token_revoked" } });
    await expect(call()).resolves.toBe("failed");
    expect(alert).not.toHaveBeenCalled();
  });

  it("answers failed, and does not throw, when something unexpected goes wrong", async () => {
    update.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(call()).resolves.toBe("failed");
  });
});

describe("splitAttachments", () => {
  it("counts the removed ones and keeps the rest in order", () => {
    const { removed, keep } = splitAttachments([slackCard(ONE), "junk", slackCard(TWO), slackCard(ONE)], new Set(["example.test/one.jpg"]));
    expect(removed).toBe(2);
    expect(keep.map((a) => a.from_url)).toEqual([TWO]);
  });
});

describe("splitAttachments with a shared Slack message", () => {
  const PERMALINK = "https://example.slack.com/archives/C1/p1700000000000100";
  const share = { id: 2, is_share: true, is_msg_unfurl: true, from_url: PERMALINK, original_url: PERMALINK, text: "quoted", author_name: "Ada Example", ts: "1700000000.000100" };
  it("matches the share by the key the Hub stores for it, and keeps the other previews", () => {
    const key = shareRemoveKey(share)!;
    expect(key).toBe(`url:${PERMALINK}`);
    const { removed, keep } = splitAttachments([slackCard(ONE), share, slackCard(TWO)], new Set([normalizeLinkForMatch(key.slice(4))!]));
    expect(removed).toBe(1);
    expect(keep.map((a) => a.from_url)).toEqual([ONE, TWO]);
  });
  it("matches by the permalink alone when Slack sent no original address", () => {
    const { original_url: _unused, ...bare } = share;
    expect(splitAttachments([bare], new Set([normalizeLinkForMatch(PERMALINK)!])).removed).toBe(1);
  });
});

describe("after Slack's message_changed comes back", () => {
  it("does not bring the removed card back, and shows the kept one once", () => {
    // What the webhook stores from the echo of our update: the remaining attachment only.
    const stored = [slackCard(TWO)];
    const unfurls = parseUnfurls({ attachments: stored }, { bot: false, body: "x" }).unfurls;
    const hidden = new Set([key(ONE)]);
    const cards = withLinkPreviews(unfurls, [{ messageId: MESSAGE, position: 0, url: ONE, finalUrl: ONE, kind: "image", status: "ok", title: null, description: null, siteName: null, imageUrl: ONE, fetchedAt: "2026-10-01T00:00:00Z" }], hidden);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "card", titleLink: TWO });
  });

  it("keeps hiding the removed link if Slack unfurls it again later", () => {
    const unfurls = parseUnfurls({ attachments: [slackCard(ONE)] }, { bot: false, body: "x" }).unfurls;
    const hubPreview = { messageId: MESSAGE, position: 0, url: ONE, finalUrl: ONE, kind: "image" as const, status: "ok" as const, title: null, description: null, siteName: null, imageUrl: ONE, fetchedAt: "2026-10-01T00:00:00Z" };
    expect(withLinkPreviews(unfurls, [hubPreview], new Set([key(ONE)]))).toEqual([]);
    // Without the Hub's own preview, Slack's card is hidden by the same mark.
    expect(withLinkPreviews(unfurls, [], new Set([key(ONE)]))).toEqual([]);
  });
});


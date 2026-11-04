import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMessage = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true }));
vi.mock("@slack/web-api", () => ({ WebClient: class { chat = { postMessage }; } }));
const getSlackBotToken = vi.fn(async () => "xoxb-test" as string | null);
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: () => getSlackBotToken() }));

import { escapeSlackText, postToSlackChannel } from "@/lib/slack";

beforeEach(() => {
  postMessage.mockClear();
  getSlackBotToken.mockResolvedValue("xoxb-test");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("escapeSlackText", () => {
  it("writes &, < and > as Slack's entities", () => {
    expect(escapeSlackText("Q&A <beta> & more")).toBe("Q&amp;A &lt;beta&gt; &amp; more");
  });
});

describe("postToSlackChannel", () => {
  it("posts to the channel without link previews when not in test mode", async () => {
    vi.stubEnv("SLACK_TEST_MODE", "false");
    expect(await postToSlackChannel({ channel: "C1", text: "hi", blocks: [{ type: "divider" }] })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ channel: "C1", text: "hi", blocks: [{ type: "divider" }], unfurl_links: false, unfurl_media: false });
  });

  it("only logs in test mode, so a local or preview run never writes to a real channel", async () => {
    vi.stubEnv("SLACK_TEST_MODE", "true");
    expect(await postToSlackChannel({ channel: "C1", text: "hi" })).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("throws without a bot token, so the caller gives its claim back", async () => {
    vi.stubEnv("SLACK_TEST_MODE", "false");
    getSlackBotToken.mockResolvedValue(null);
    await expect(postToSlackChannel({ channel: "C1", text: "hi" })).rejects.toThrow("No Slack bot token");
  });
});

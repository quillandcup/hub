import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createHmac } from "crypto";

/**
 * The webhook's wiring of a `link_shared` event (lib/chat/slack-link-shared.ts): signed fixtures in, `chat.unfurl` out, over the in-memory
 * repositories. The text of the cards is covered in chat-slack-link-unfurl.test.ts.
 */
const { afterWork, unfurl, token } = vi.hoisted(() => ({ afterWork: [] as Promise<unknown>[], unfurl: vi.fn(), token: { value: "xoxb-test" as string | undefined } }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void | Promise<void>) => void afterWork.push(Promise.resolve().then(callback)) };
});
vi.mock("@/lib/slack-activity-projection", () => ({ projectSlackActivity: vi.fn(async () => ({ messages: 0, reactions: 0 })) }));
vi.mock("@/lib/chat-projection", () => ({ projectChatMessage: vi.fn(async () => false) }));
vi.mock("@/lib/chat/gap-fill", () => ({ fillMessageGap: vi.fn(), fillThreadIfRootMissing: vi.fn() }));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessageBySlackTs: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: vi.fn(async () => token.value), forgetSlackBotToken: vi.fn() }));
vi.mock("@/lib/slack-client", () => ({ createSlackClient: vi.fn(() => ({ chat: { unfurl } })) }));
const everyone = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/features.server", async (orig) => ({ ...(await orig<typeof import("@/lib/features.server")>()), isFeatureOnForEveryone: vi.fn(async () => everyone.on) }));

let dataset: InstanceType<typeof import("@/lib/data/in-memory").InMemoryDataset>;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { POST } from "@/app/api/webhooks/slack/route";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";

const SECRET = "test-slack-secret";
const PUBLIC = "chn_AAAAAAAAAAP1";
const RESTRICTED = "chn_AAAAAAAAAAP3";
const DM = "chn_AAAAAAAAAAD1";
const AUTHOR = "mbr_AAAAAAAAAAA1";
const fixture = (id: string, channel: string) => ({ id, channel_id: channel, author_member_id: AUTHOR, origin: "app", created_at: "2026-10-01T15:00:00Z" });

const linkShared = (urls: string[], over: Record<string, unknown> = {}) => ({
  type: "link_shared",
  channel: "C1",
  user: "U1",
  message_ts: "1700000000.000100",
  unfurl_id: "U1-abc",
  source: "conversations_history",
  links: urls.map((url) => ({ domain: new URL(url).hostname, url })),
  ...over,
});

async function send(event: Record<string, unknown>, opts: { timestamp?: number; secret?: string } = {}) {
  const body = JSON.stringify({ type: "event_callback", event });
  const timestamp = (opts.timestamp ?? Math.floor(Date.now() / 1000)).toString();
  const signature = "v0=" + createHmac("sha256", opts.secret ?? SECRET).update(`v0:${timestamp}:${body}`).digest("hex");
  const response = await POST(
    new Request("http://localhost:3000/api/webhooks/slack", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-slack-signature": signature, "x-slack-request-timestamp": timestamp }),
      body,
    }) as unknown as NextRequest,
  );
  await Promise.all(afterWork.splice(0));
  return response;
}

const sentText = (url: string) => (unfurl.mock.calls[0][0] as { unfurls: Record<string, { blocks: { text?: { text: string } }[] }> }).unfurls[url].blocks[0].text?.text;

beforeEach(() => {
  unfurl.mockReset().mockResolvedValue({ ok: true });
  token.value = "xoxb-test";
  everyone.on = true;
  vi.stubEnv("SLACK_SIGNING_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dataset = new InMemoryDataset({
    members: [{ id: AUTHOR, name: "Ada Example", displayName: "Fern Quillsby" }],
    chatChannels: [
      { id: PUBLIC, name: "general", kind: "channel", visibility: "public" },
      { id: RESTRICTED, name: "restricted-room", kind: "channel", visibility: "public", restricted: true },
      { id: DM, kind: "dm", visibility: "private" },
    ],
    chatMessages: [fixture("msg_AAAAAAAAAAA1", PUBLIC), fixture("msg_AAAAAAAAAAA3", RESTRICTED), fixture("msg_AAAAAAAAAAA4", DM)] as never,
    chatMessageContents: [{ message_id: "msg_AAAAAAAAAAA1", body: "secret words" }] as never,
  });
});

describe("a link_shared event at the Slack webhook", () => {
  it("answers a link to a message in a public channel with who and where, never the text", async () => {
    const url = `${APP_URL}/chat/${PUBLIC}?m=msg_AAAAAAAAAAA1`;
    expect((await send(linkShared([url]))).status).toBe(200);
    expect(unfurl).toHaveBeenCalledTimes(1);
    expect(unfurl.mock.calls[0][0]).toMatchObject({ unfurl_id: "U1-abc", source: "conversations_history" });
    expect(sentText(url)).toBe("A message from Fern Quillsby in #general in Hub Chat");
    expect(JSON.stringify(unfurl.mock.calls[0][0])).not.toContain("secret words");
  });

  it("answers a link in a restricted channel and in a direct message with the neutral card", async () => {
    for (const [channel, message] of [[RESTRICTED, "msg_AAAAAAAAAAA3"], [DM, "msg_AAAAAAAAAAA4"]]) {
      unfurl.mockClear();
      const url = `${APP_URL}/chat/${channel}?m=${message}`;
      await send(linkShared([url]));
      expect(sentText(url), channel).toBe("Link to the Hub");
    }
  });

  it("answers with the neutral card until the descriptive cards are on for everyone", async () => {
    everyone.on = false;
    const url = `${APP_URL}/chat/${PUBLIC}?m=msg_AAAAAAAAAAA1`;
    await send(linkShared([url]));
    expect(sentText(url)).toBe("Link to the Hub");
  });

  it("ignores a link on another domain, and does not call Slack at all", async () => {
    expect((await send(linkShared(["https://elsewhere.example.test/chat/x"]))).status).toBe(200);
    expect(unfurl).not.toHaveBeenCalled();
  });

  it("refuses an event with a bad signature or the wrong secret, and does nothing", async () => {
    const url = `${APP_URL}/prickles/prkl_AAAAAAAAAAA1`;
    expect((await send(linkShared([url]), { secret: "not-the-secret" })).status).toBe(401);
    expect(unfurl).not.toHaveBeenCalled();
  });

  it("refuses a replay: a correctly signed request older than five minutes", async () => {
    const url = `${APP_URL}/prickles/prkl_AAAAAAAAAAA1`;
    const old = Math.floor(Date.now() / 1000) - 10 * 60;
    expect((await send(linkShared([url]), { timestamp: old })).status).toBe(401);
    expect(unfurl).not.toHaveBeenCalled();
  });

  it("does nothing for a malformed event, and answers 200 whatever Slack says", async () => {
    expect((await send({ type: "link_shared", links: "nope" })).status).toBe(200);
    expect(unfurl).not.toHaveBeenCalled();
    unfurl.mockResolvedValue({ ok: false, error: "cannot_unfurl_url" });
    expect((await send(linkShared([`${APP_URL}/prickles/prkl_AAAAAAAAAAA1`]))).status).toBe(200);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("cannot_unfurl_url");
  });

  it("does nothing without a bot token", async () => {
    token.value = undefined;
    expect((await send(linkShared([`${APP_URL}/prickles/prkl_AAAAAAAAAAA1`]))).status).toBe(200);
    expect(unfurl).not.toHaveBeenCalled();
  });
});

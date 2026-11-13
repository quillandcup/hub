import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { hubMessageMetadata } from "@/lib/chat/slack-post";

/**
 * The webhook's wiring of lib/chat/slack-side-unfurl-removal.ts: the author of a message written in the Hub removes Slack's link preview
 * inside Slack, Slack sends the message again with an attachment fewer, and the Hub hides its own preview of that link (the same mark as
 * its X). Runs over the in-memory repositories; the function itself is covered in chat-slack-side-unfurl-removal.test.ts.
 */
const { afterWork } = vi.hoisted(() => ({ afterWork: [] as Promise<unknown>[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void | Promise<void>) => void afterWork.push(Promise.resolve().then(callback)) };
});
vi.mock("@/lib/slack-activity-projection", () => ({ projectSlackActivity: vi.fn(async () => ({ messages: 0, reactions: 0 })) }));
vi.mock("@/lib/chat-projection", () => ({ projectChatMessage: vi.fn(async () => false) }));
vi.mock("@/lib/chat/gap-fill", () => ({ fillMessageGap: vi.fn(), fillThreadIfRootMissing: vi.fn() }));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessageBySlackTs: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { POST } from "@/app/api/webhooks/slack/route";
import { createRepos } from "@/lib/data/repos";

const SECRET = "test-slack-secret";
const CHANNEL = "C_SIDE_UNFURL";
const TEAM = "T_SIDE_UNFURL";
const ONE = "https://example.test/one";
const TWO = "https://example.test/two";
const TEXT = `look ${ONE} and ${TWO}`;
const card = (url: string) => ({ id: 1, from_url: url, original_url: url, title: `Title ${url}`, title_link: url, service_name: "Example" });
const preview = (messageId: string, url: string) =>
  ({ message_id: messageId, position: 0, url, final_url: null, kind: "link", status: "ok", title: `Page ${url}`, description: null, site_name: null, image_url: null, fetched_at: "2026-01-01T00:00:00Z" }) as never;

async function send(event: Record<string, unknown>) {
  const body = JSON.stringify({ type: "event_callback", team_id: TEAM, event });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = "v0=" + createHmac("sha256", SECRET).update(`v0:${timestamp}:${body}`).digest("hex");
  const response = await POST(
    new Request("http://localhost:3000/api/webhooks/slack", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-slack-signature": signature, "x-slack-request-timestamp": timestamp }),
      body,
    }) as unknown as NextRequest
  );
  expect(response.status).toBe(200);
  await Promise.all(afterWork.splice(0));
}

function seed(rows: { id: string; ts: string; origin: "app" | "slack"; before: unknown[]; previews: string[] }[]) {
  dataset = new InMemoryDataset({
    slackWorkspaces: [{ id: "slws_AAAAAAAAAAA1", team_id: TEAM, name: "Primary", url: null, is_primary: true, created_at: "2026-01-01T00:00:00Z", deleted_at: null }],
    slackMessages: rows.map((r) => ({ channel_id: CHANNEL, message_ts: r.ts, user_id: "U1", occurred_at: "2026-01-01T00:00:00Z", raw_payload: { text: TEXT, attachments: r.before } }) as never),
    chatChannels: [{ id: "chn_AAAAAAAAAAC1", slack_channel_id: CHANNEL } as never],
    chatMessages: rows.map((r) => ({ id: r.id, channel_id: "chn_AAAAAAAAAAC1", origin: r.origin, slack_ts: r.ts, author_member_id: "mbr_AAAAAAAAAAA1", deleted_at: null }) as never),
    chatLinkPreviews: rows.flatMap((r) => r.previews.map((u) => preview(r.id, u))),
  });
}
const changed = (ts: string, attachments: unknown[], text = TEXT) =>
  send({ type: "message", subtype: "message_changed", channel: CHANNEL, event_ts: "1.9", message: { type: "message", ts, text, attachments, metadata: hubMessageMetadata("msg_AAAAAAAAAAD1") } });
const hidden = async (id: string) => [...((await createRepos({} as never).chatLinkPreviews.hiddenKeys([id])).get(id) ?? [])].sort();
const stored = async (ts: string) => (await createRepos({} as never).slackMessages.rawPayload(CHANNEL, ts)) as { attachments: unknown[] };

beforeEach(() => {
  afterWork.length = 0;
  vi.stubEnv("SLACK_SIGNING_SECRET", SECRET);
});

describe("Slack webhook: a preview removed inside Slack on a message written in the Hub", () => {
  it("hides the Hub preview of the one link whose Slack preview was removed, and stores Slack's new payload", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", ts: "10.1", origin: "app", before: [card(ONE), card(TWO)], previews: [ONE, TWO] }]);
    await changed("10.1", [card(TWO)]);
    expect(await hidden("msg_AAAAAAAAAAD1")).toEqual([`url:${ONE}`]);
    expect((await stored("10.1")).attachments).toHaveLength(1);
  });

  it("is safe to repeat, and to receive after the Hub's own removal wrote its mark", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", ts: "10.1", origin: "app", before: [card(ONE)], previews: [ONE] }]);
    await createRepos({} as never).chatLinkPreviews.hide("msg_AAAAAAAAAAD1", `url:${ONE}`);
    await changed("10.1", []);
    await changed("10.1", []);
    expect(await hidden("msg_AAAAAAAAAAD1")).toEqual([`url:${ONE}`]);
  });

  it("does nothing when Slack's preview first arrives", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", ts: "10.1", origin: "app", before: [], previews: [ONE] }]);
    await changed("10.1", [card(ONE)]);
    expect(await hidden("msg_AAAAAAAAAAD1")).toEqual([]);
  });

  it("does nothing for an edit that took the link out of the text", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", ts: "10.1", origin: "app", before: [card(ONE)], previews: [ONE] }]);
    await changed("10.1", [], "no link now");
    expect(await hidden("msg_AAAAAAAAAAD1")).toEqual([]);
  });

  it("does nothing for a message written in Slack", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", ts: "10.1", origin: "slack", before: [card(ONE)], previews: [ONE] }]);
    await changed("10.1", []);
    expect(await hidden("msg_AAAAAAAAAAD1")).toEqual([]);
  });

  it("does nothing when the Hub has no preview of the link", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", ts: "10.1", origin: "app", before: [card(ONE)], previews: [] }]);
    await changed("10.1", []);
    expect(await hidden("msg_AAAAAAAAAAD1")).toEqual([]);
  });
});

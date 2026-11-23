import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { ChatInboundSink, InboundEvent } from "@/lib/chat/transport";

/**
 * The Slack adapter's inbound handler, replayed: Slack delivers an event more than once, out of order, and an edit before the message it
 * edits. Slack's own raw copy (Bronze) must end the same whatever the order, and the handler reports each event to the sink, which owns
 * what the chat does (the projection is idempotent: tests/lib/chat-inbound.test.ts). No network, no database: in-memory repositories and a
 * recording sink. The route's own tests (tests/api/webhooks) cover the same handler against a real database.
 */

const afterWork = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => void | Promise<void>) => void afterWork.push(Promise.resolve(callback())),
}));
const repos = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos.current,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@supabase/supabase-js", async (original) => ({ ...(await original<typeof import("@supabase/supabase-js")>()), createClient: () => ({}) }));
vi.mock("@/lib/slack-activity-projection", () => ({ projectSlackActivity: vi.fn(async () => ({ messages: 0, reactions: 0 })) }));
const gap = vi.hoisted(() => ({ fillMessageGap: vi.fn(async () => ({ claimed: false })), fillThreadIfRootMissing: vi.fn(async () => null) }));
vi.mock("@/modules/chat/slack/gap-fill", () => gap);
vi.mock("@/modules/chat/slack/lesson-links", () => ({ rewriteInSlack: () => async () => {}, shareLessonLinkBySlackTs: vi.fn(async () => "skipped") }));

import { handleSlackWebhook } from "@/modules/chat/slack/webhook";

const CHANNEL = "C0REPLAY01";
const NOW_S = Math.floor(Date.now() / 1000);
const TS = `${NOW_S - 3600}.000100`;
let dataset: InMemoryDataset;
let seen: { call: "changed" | "arrived"; event: Partial<InboundEvent> }[];
let present: boolean;

const sink: ChatInboundSink = {
  messageChanged: async (_db, event) => {
    seen.push({ call: "changed", event });
    return { present };
  },
  messageArrived: async (_db, event) => void seen.push({ call: "arrived", event }),
};

const post = async (event: Record<string, unknown>) => {
  const body = JSON.stringify({ type: "event_callback", event });
  const response = await handleSlackWebhook(new Request("http://localhost/api/webhooks/slack", { method: "POST", body }) as unknown as NextRequest, sink);
  while (afterWork.length > 0) await Promise.all(afterWork.splice(0));
  return response;
};

const message = (extra: Record<string, unknown> = {}) => ({ type: "message", channel: CHANNEL, user: "U_ADA", ts: TS, text: "hello", ...extra });
const edit = (text: string) => ({ type: "message", subtype: "message_changed", channel: CHANNEL, event_ts: `${NOW_S - 3500}.000200`, message: { type: "message", user: "U_ADA", ts: TS, text, edited: { user: "U_ADA", ts: `${NOW_S - 3500}.000200` } } });
const stored = () => dataset.slackMessages.filter((m) => m.channel_id === CHANNEL).map((m) => ({ ts: m.message_ts, text: m.text, deleted: !!m.deleted_at }));

beforeEach(() => {
  vi.stubEnv("SLACK_SIGNING_SECRET", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  dataset = new InMemoryDataset({});
  repos.current = createInMemoryRepos(dataset);
  seen = [];
  present = true;
  gap.fillMessageGap.mockClear();
});

describe("the Slack webhook replayed", () => {
  it("keeps one Bronze row when the same message arrives twice, and reports each delivery to the sink", async () => {
    await post(message());
    await post(message());
    expect(stored()).toEqual([{ ts: TS, text: "hello", deleted: false }]);
    expect(seen.filter((s) => s.call === "changed")).toHaveLength(2);
    expect(seen[0]).toEqual({ call: "changed", event: { transport: "slack", channelRef: CHANNEL, ref: TS, kind: "message" } });
  });

  it("tells the sink to notify only when the chat has the new message", async () => {
    await post(message());
    expect(seen.map((s) => s.call)).toEqual(["changed", "arrived"]);
    seen = [];
    present = false;
    await post(message({ ts: `${NOW_S - 3600}.000300` }));
    expect(seen.map((s) => s.call)).toEqual(["changed"]);
  });

  it("does not invent a message for an edit that comes before it, and applies the edit once the message is there", async () => {
    present = false;
    await post(edit("hello, edited"));
    expect(stored()).toEqual([]);
    expect(seen).toEqual([{ call: "changed", event: { transport: "slack", channelRef: CHANNEL, ref: TS, kind: "edit" } }]);
    // The message then arrives (its own text), and the edit is delivered again: the edit lands on the stored row.
    present = true;
    await post(message());
    await post(edit("hello, edited"));
    expect(stored()).toEqual([{ ts: TS, text: "hello, edited", deleted: false }]);
  });

  it("ends the same whether the edit is delivered twice or once, and an old edit does not undo a newer one", async () => {
    await post(message());
    await post(edit("v2"));
    await post(edit("v2"));
    expect(stored()).toEqual([{ ts: TS, text: "v2", deleted: false }]);
  });

  it("marks a deleted message once however often the delete arrives, and a delete before the message leaves nothing live", async () => {
    await post({ type: "message", subtype: "message_deleted", channel: CHANNEL, deleted_ts: TS, event_ts: `${NOW_S - 3400}.000100` });
    expect(stored()).toEqual([]);
    await post(message());
    await post({ type: "message", subtype: "message_deleted", channel: CHANNEL, deleted_ts: TS, event_ts: `${NOW_S - 3400}.000100` });
    await post({ type: "message", subtype: "message_deleted", channel: CHANNEL, deleted_ts: TS, event_ts: `${NOW_S - 3400}.000100` });
    expect(stored()).toEqual([{ ts: TS, text: "hello", deleted: true }]);
    expect(seen.filter((s) => s.event.kind === "delete")).toHaveLength(3);
    // A delete asks for no gap-fill: a deleted message is not there to fetch.
    expect(gap.fillMessageGap).not.toHaveBeenCalled();
  });

  it("keeps one reaction row for a reaction added twice, and a removal before it is added does not break the add", async () => {
    const added = { type: "reaction_added", user: "U_GRACE", reaction: "tada", item: { channel: CHANNEL, ts: TS }, event_ts: `${NOW_S - 3300}.000100` };
    const removed = { ...added, type: "reaction_removed", event_ts: `${NOW_S - 3200}.000100` };
    await post(removed);
    await post(added);
    await post(added);
    const rows = dataset.slackReactions.filter((r) => r.channel_id === CHANNEL);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at ?? null).toBeNull();
    await post(removed);
    expect(dataset.slackReactions.filter((r) => r.channel_id === CHANNEL && !r.deleted_at)).toHaveLength(0);
    expect(seen.every((s) => s.event.kind === "reaction")).toBe(true);
  });

  it("asks core to project a message even when the event is for one the chat lacks, and then fills the gap from Slack", async () => {
    present = false;
    await post(message());
    expect(gap.fillMessageGap).toHaveBeenCalledWith(expect.anything(), { channelId: CHANNEL, ts: TS, source: "webhook" });
  });

  it("answers 200 and reports nothing for an event type it does not use", async () => {
    const response = await post({ type: "channel_rename", channel: { id: CHANNEL } });
    expect(response.status).toBe(200);
    expect(seen).toEqual([]);
  });
});

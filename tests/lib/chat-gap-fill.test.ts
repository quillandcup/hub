import { describe, it, expect, vi, beforeEach } from "vitest";

const { writesEnabled, projectChatMessage, markRemoved } = vi.hoisted(() => ({
  writesEnabled: vi.fn(() => true),
  projectChatMessage: vi.fn(async () => true),
  markRemoved: vi.fn(async () => 0),
}));
vi.mock("@/lib/chat/slack-post", () => ({ chatSlackWritesEnabled: () => writesEnabled() }));
vi.mock("@/lib/chat-projection", () => ({ projectChatMessage: (...a: unknown[]) => projectChatMessage(...(a as [])) }));
vi.mock("@/lib/slack-reactions", () => ({ markRemovedSlackReactions: (...a: unknown[]) => markRemoved(...(a as [])) }));

import { catchUpChannel, fillMessageGap, fillThreadIfRootMissing } from "@/lib/chat/gap-fill";
import { setClock, systemClock } from "@/lib/clock";
import { InMemoryChatRepository, type GapFillOutcome } from "@/lib/data/chat";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySlackMessageRepository, type NewSlackMessage, type NewSlackReaction } from "@/lib/data/slack-messages";
import { InMemorySlackUserRepository } from "@/lib/data/slack-users";

type Call = { method: string; args: unknown[] };
type Query = { table: string; schema: string; calls: Call[] };

/** A Supabase stand-in: every query is recorded, and `answer` says what it returns. */
function fakeService(answer: (q: Query) => unknown, rpcAnswer: (name: string) => unknown = () => "fill-1") {
  const queries: Query[] = [];
  const make = (schema: string) => ({
    from: (table: string) => {
      const q: Query = { table, schema, calls: [] };
      queries.push(q);
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(answer(q)).then(resolve, reject);
            if (prop === "maybeSingle") return () => Promise.resolve(answer(q));
            return (...args: unknown[]) => {
              q.calls.push({ method: prop, args });
              return chain;
            };
          },
        }
      );
      return chain;
    },
  });
  const rpc = vi.fn(async (name: string, args: unknown) => ({ data: rpcAnswer(name), error: null, args }));
  return Object.assign(make("public"), { schema: (s: string) => make(s), rpc, queries }) as never as import("@supabase/supabase-js").SupabaseClient & {
    rpc: typeof rpc;
    queries: Query[];
  };
}

const has = (q: Query, method: string, ...args: unknown[]) => q.calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const CHANNEL = { name: "hosts", kind: "channel", visibility: "private", bridge_disabled: false };

interface World {
  /** chat_channels row for the Slack channel, or null when the chat doesn't mirror it. */
  channel: Record<string, unknown> | null;
  /** Slack message ts the chat already has. */
  chatHas: Set<string>;
  /** bronze messages / reactions already stored. */
  bronzeMessages: string[];
  bronzeReactions: { message_ts: string; reaction: string; user_id: string }[];
  newestBronzeTs: string | null;
  /** Replies bronze already has, by thread root. */
  bronzeReplies: { thread_ts: string; message_ts: string }[];
}
let world: World;

// The chat tables are the in-memory ChatRepository, built from `world`; the Bronze reads and writes stay on the fake client.
let finishedWith: GapFillOutcome | undefined;
/** Repository methods that throw, to test the failure paths. */
const failing = new Set<string>();
const chatRepo = () => {
  const repo = new InMemoryChatRepository(
    new InMemoryDataset({
      chatChannels: world.channel ? [{ id: "chn_AAAAAAAAAAA1", slack_channel_id: "C1", ...world.channel }] : [],
      chatMessages: [...world.chatHas].map((ts, i) => ({ id: `msg_${String(i).padStart(12, "A")}`, channel_id: "chn_AAAAAAAAAAA1", slack_ts: ts })),
    }),
  );
  repo.finishGapFill = async (_id, outcome) => {
    if (failing.has("finishGapFill")) throw new Error("finish boom");
    finishedWith = outcome;
  };
  if (failing.has("mirroredChannel")) repo.mirroredChannel = async () => { throw new Error("channel boom"); };
  if (failing.has("messageIdBySlackTs")) repo.messageIdBySlackTs = async () => { throw new Error("message boom"); };
  return repo;
};
/** What the fill wrote to Bronze, as it passed it to the repository. */
let written: { messages: NewSlackMessage[]; reactions: NewSlackReaction[] };
/** The Bronze side: Slack users and what is already stored, read from `world`; writes are recorded in `written`. */
const bronzeRepos = () => {
  const stored = new Map<string, { channel_id: string; message_ts: string; user_id: string; occurred_at: string; thread_ts?: string }>();
  for (const ts of world.bronzeMessages) stored.set(ts, { channel_id: "C1", message_ts: ts, user_id: "U_GALE", occurred_at: "2026-01-01T00:00:00Z" });
  for (const r of world.bronzeReplies) stored.set(r.message_ts, { channel_id: "C1", message_ts: r.message_ts, user_id: "U_GALE", occurred_at: "2026-01-01T00:00:00Z", thread_ts: r.thread_ts });
  const data = new InMemoryDataset({
    slackUsers: [{ user_id: "U_GALE", email: "gale@example.test", real_name: "Gale", name: "gale" }],
    slackMessages: [...stored.values()],
    slackReactions: world.bronzeReactions.map((r) => ({ ...r, channel_id: "C1", occurred_at: "2026-01-01T00:00:00Z" })),
  });
  const messages = new InMemorySlackMessageRepository(data);
  messages.newestTimestamp = async () => world.newestBronzeTs;
  const upsertMessages = messages.upsertMessages.bind(messages);
  messages.upsertMessages = async (rows) => {
    written.messages.push(...rows);
    return upsertMessages(rows);
  };
  const upsertReactions = messages.upsertReactions.bind(messages);
  messages.upsertReactions = async (rows) => {
    written.reactions.push(...rows);
    return upsertReactions(rows);
  };
  return { slackMessages: messages, slackUsers: new InMemorySlackUserRepository(data) };
};
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: (db: never) => ({ ...actual.createRepos(db), chat: chatRepo(), ...bronzeRepos() }) };
});

const answer = (): unknown => ({ data: null, error: null });

const slackMessage = (ts: string, extra: Record<string, unknown> = {}) => ({ ts, user: "U_GALE", text: `message ${ts}`, ...extra });
const reaction = (name: string, users: string[], count = users.length) => ({ name, users, count });

function slackStub(opts: { get?: unknown; replies?: Record<string, unknown[]>; history?: unknown[] } = {}) {
  return {
    reactions: { get: vi.fn(async () => ({ ok: true, message: opts.get })) },
    conversations: {
      replies: vi.fn(async (args: { ts: string }) => ({ ok: true, messages: opts.replies?.[args.ts] ?? [] })),
      history: vi.fn(async () => ({ ok: true, messages: opts.history ?? [] })),
    },
  } as never as import("@slack/web-api").WebClient & {
    reactions: { get: ReturnType<typeof vi.fn> };
    conversations: { replies: ReturnType<typeof vi.fn>; history: ReturnType<typeof vi.fn> };
  };
}

const claimCall = (service: ReturnType<typeof fakeService>) => service.rpc.mock.calls.find(([name]) => name === "claim_chat_gap_fill")?.[1] as Record<string, unknown>;
/** What the fill recorded as its outcome, by column name. */
const finished = (_service: ReturnType<typeof fakeService>) =>
  finishedWith && { messages_recovered: finishedWith.messagesRecovered, reactions_recovered: finishedWith.reactionsRecovered, messages_seen: finishedWith.messagesSeen, error: finishedWith.error };
const upserted = (_service: ReturnType<typeof fakeService>, table: string) => {
  const rows = table === "slack_messages" ? written.messages : written.reactions;
  return rows.length > 0 ? (rows as unknown as Record<string, unknown>[]) : undefined;
};

beforeEach(() => {
  world = { channel: { ...CHANNEL }, chatHas: new Set(), bronzeMessages: [], bronzeReactions: [], newestBronzeTs: null, bronzeReplies: [] };
  writesEnabled.mockReset();
  writesEnabled.mockReturnValue(true);
  projectChatMessage.mockClear();
  markRemoved.mockClear();
  finishedWith = undefined;
  written = { messages: [], reactions: [] };
  failing.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fillMessageGap", () => {
  it("fetches the message Slack told us about, stores it with its reactions, projects it and records what was new", async () => {
    world.bronzeReactions = [{ message_ts: "100.1", reaction: "tada", user_id: "U_GALE" }];
    const slack = slackStub({ get: slackMessage("100.1", { reactions: [reaction("tada", ["U_GALE"]), reaction("eyes", ["U_GALE", "U_FERN"])] }) });
    const service = fakeService(answer);

    const result = await fillMessageGap(service, { channelId: "C1", ts: "100.1", source: "webhook", slack });

    expect(result).toEqual({ claimed: true, messages: 1, reactions: 2, seen: 1 });
    expect(slack.reactions.get).toHaveBeenCalledWith({ channel: "C1", timestamp: "100.1", full: true });
    expect(claimCall(service)).toMatchObject({ p_source: "webhook", p_scope: "message", p_channel: "C1", p_ts: "100.1" });
    const messages = upserted(service, "slack_messages")!;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ channel_id: "C1", message_ts: "100.1", user_id: "U_GALE", user_email: "gale@example.test", text: "message 100.1" });
    expect(upserted(service, "slack_reactions")).toHaveLength(3);
    expect(projectChatMessage).toHaveBeenCalledWith(service, "C1", "100.1");
    expect(finished(service)).toMatchObject({ messages_recovered: 1, reactions_recovered: 2, messages_seen: 1, error: null });
  });

  it("also fetches the thread when the message is a reply and its root isn't in the chat", async () => {
    const reply = slackMessage("100.2", { thread_ts: "100.0", reactions: [reaction("tada", ["U_GALE"])] });
    const slack = slackStub({ get: reply, replies: { "100.0": [slackMessage("100.0", { reply_count: 1 }), reply] } });

    const result = await fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.2", source: "webhook", slack });

    expect(slack.conversations.replies).toHaveBeenCalledWith(expect.objectContaining({ channel: "C1", ts: "100.0" }));
    expect(result.messages).toBe(2);
    expect(projectChatMessage).toHaveBeenCalledTimes(2);
  });

  it("leaves the thread alone when its root is already in the chat", async () => {
    world.chatHas.add("100.0");
    const slack = slackStub({ get: slackMessage("100.2", { thread_ts: "100.0" }) });
    const result = await fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.2", source: "webhook", slack });
    expect(slack.conversations.replies).not.toHaveBeenCalled();
    expect(result.messages).toBe(1);
  });

  it("does nothing when another fill has it covered, off production, or for a conversation the chat doesn't mirror", async () => {
    const slack = slackStub({ get: slackMessage("100.1") });

    const covered = fakeService(answer, () => null);
    await expect(fillMessageGap(covered, { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toEqual({ claimed: false, messages: 0, reactions: 0, seen: 0 });

    writesEnabled.mockReturnValue(false);
    await expect(fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toMatchObject({ claimed: false });
    writesEnabled.mockReturnValue(true);

    world.channel = null;
    await expect(fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toMatchObject({ claimed: false });
    world.channel = { ...CHANNEL, bridge_disabled: true };
    await expect(fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toMatchObject({ claimed: false });

    expect(slack.reactions.get).not.toHaveBeenCalled();
    expect(projectChatMessage).not.toHaveBeenCalled();
  });

  it("does nothing, and says so in the log, when the database can't hand out a claim", async () => {
    const slack = slackStub({ get: slackMessage("100.1") });
    const service = fakeService(answer);
    service.rpc.mockResolvedValueOnce({ data: null, error: { message: "connection lost" }, args: {} } as never);

    await expect(fillMessageGap(service, { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toEqual({ claimed: false, messages: 0, reactions: 0, seen: 0 });

    expect(console.error).toHaveBeenCalledWith("claim_chat_gap_fill failed:", "connection lost");
    expect(slack.reactions.get).not.toHaveBeenCalled();
  });

  it("treats an unreadable channel as not mirrored, and a failed outcome write or message lookup as nothing to act on", async () => {
    const slack = slackStub({ get: slackMessage("100.1") });

    failing.add("mirroredChannel");
    await expect(fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toMatchObject({ claimed: false });
    expect(console.error).toHaveBeenCalledWith(expect.any(String), "C1", "channel boom");
    failing.clear();

    // The root lookup fails: the root counts as missing, so the thread is fetched.
    failing.add("messageIdBySlackTs");
    failing.add("finishGapFill");
    const reply = slackMessage("100.2", { thread_ts: "100.0" });
    const threadSlack = slackStub({ get: reply, replies: { "100.0": [slackMessage("100.0"), reply] } });
    await expect(fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.2", source: "webhook", slack: threadSlack })).resolves.toMatchObject({ claimed: true });
    expect(threadSlack.conversations.replies).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("recording a gap-fill failed:", "finish boom");
  });

  it("records a Slack failure instead of throwing", async () => {
    const slack = slackStub();
    slack.reactions.get.mockRejectedValue({ data: { error: "message_not_found" } });
    const service = fakeService(answer);

    await expect(fillMessageGap(service, { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toEqual({
      claimed: true,
      messages: 0,
      reactions: 0,
      seen: 0,
      error: "message_not_found",
    });
    expect(finished(service)).toMatchObject({ error: "message_not_found" });
  });

  it("stores nothing for a message that isn't a message (a pin notice)", async () => {
    const slack = slackStub({ get: slackMessage("100.1", { subtype: "pinned_item" }) });
    const service = fakeService(answer);
    await expect(fillMessageGap(service, { channelId: "C1", ts: "100.1", source: "webhook", slack })).resolves.toEqual({ claimed: true, messages: 0, reactions: 0, seen: 0 });
    expect(upserted(service, "slack_messages")).toBeUndefined();
  });

  it("only marks reactions as taken back where Slack listed every reactor", async () => {
    const slack = slackStub({
      get: slackMessage("100.1", { reactions: [reaction("tada", ["U_GALE"], 40)] }), // 40 reacted, one named
    });
    await fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.1", source: "webhook", slack });
    expect(markRemoved).toHaveBeenCalledWith(expect.anything(), [], expect.any(Array), expect.any(String));

    markRemoved.mockClear();
    const complete = slackStub({ get: slackMessage("100.1", { reactions: [reaction("tada", ["U_GALE"])] }) });
    await fillMessageGap(fakeService(answer), { channelId: "C1", ts: "100.1", source: "webhook", slack: complete });
    expect(markRemoved).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ message_ts: "100.1" })], expect.any(Array), expect.any(String));
  });
});

describe("fillThreadIfRootMissing", () => {
  it("fetches the whole thread when its root isn't in the chat", async () => {
    const slack = slackStub({ replies: { "100.0": [slackMessage("100.0", { reply_count: 2 }), slackMessage("100.1", { thread_ts: "100.0" }), slackMessage("100.2", { thread_ts: "100.0" })] } });
    const service = fakeService(answer);

    await expect(fillThreadIfRootMissing(service, { channelId: "C1", threadTs: "100.0", source: "webhook", slack })).resolves.toEqual({ claimed: true, messages: 3, reactions: 0, seen: 3 });
    expect(claimCall(service)).toMatchObject({ p_scope: "thread", p_ts: "100.0" });
  });

  it("does nothing, and doesn't claim, when the root is already there", async () => {
    world.chatHas.add("100.0");
    const slack = slackStub();
    const service = fakeService(answer);
    await expect(fillThreadIfRootMissing(service, { channelId: "C1", threadTs: "100.0", source: "webhook", slack })).resolves.toMatchObject({ claimed: false });
    expect(service.rpc).not.toHaveBeenCalled();
    expect(slack.conversations.replies).not.toHaveBeenCalled();
  });
});

describe("catchUpChannel", () => {
  it("fetches what is newer than the newest message we have, and the replies of threads among it", async () => {
    world.newestBronzeTs = "200.5";
    const slack = slackStub({
      history: [slackMessage("201.0"), slackMessage("202.0", { reply_count: 2 })],
      replies: { "202.0": [slackMessage("202.0", { reply_count: 2 }), slackMessage("202.1", { thread_ts: "202.0" }), slackMessage("202.2", { thread_ts: "202.0" })] },
    });
    const service = fakeService(answer);

    const result = await catchUpChannel(service, { channelId: "C1", source: "open", slack });

    expect(slack.conversations.history).toHaveBeenCalledWith({ channel: "C1", oldest: "200.5", limit: 100 });
    expect(slack.conversations.replies).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ claimed: true, messages: 4, reactions: 0, seen: 4 });
    expect(claimCall(service)).toMatchObject({ p_source: "open", p_scope: "channel", p_ts: null });
    expect(upserted(service, "slack_messages")!.map((m) => m.message_ts).sort()).toEqual(["201.0", "202.0", "202.1", "202.2"]);
  });

  it("looks back a few hours even when our newest message is recent, so a gap before it is found", async () => {
    setClock({ now: () => 1_700_000_000_000, sleep: async () => {} });
    world.newestBronzeTs = String(1_700_000_000 - 60); // the webhook delivered a message a minute ago
    const slack = slackStub({ history: [slackMessage("1699999000.0")] });
    world.bronzeMessages = [];

    const result = await catchUpChannel(fakeService(answer), { channelId: "C1", source: "open", slack });

    expect(slack.conversations.history).toHaveBeenCalledWith({ channel: "C1", oldest: String(1_700_000_000 - 6 * 60 * 60), limit: 100 });
    expect(result).toMatchObject({ messages: 1, seen: 1 }); // the one the webhook missed, older than the newest we have
    setClock(systemClock);
  });

  it("goes back to our newest message instead when that is further back than the lookback", async () => {
    setClock({ now: () => 1_700_000_000_000, sleep: async () => {} });
    world.newestBronzeTs = String(1_700_000_000 - 20 * 60 * 60);
    const slack = slackStub();
    await catchUpChannel(fakeService(answer), { channelId: "C1", source: "open", slack });
    expect(slack.conversations.history).toHaveBeenCalledWith({ channel: "C1", oldest: String(1_700_000_000 - 20 * 60 * 60), limit: 100 });
    setClock(systemClock);
  });

  it("tells messages Slack returned from ones that were new: all already known is seen, not recovered", async () => {
    world.bronzeMessages = ["301.0", "302.0"];
    const slack = slackStub({ history: [slackMessage("301.0"), slackMessage("302.0")] });
    const service = fakeService(answer);

    await expect(catchUpChannel(service, { channelId: "C1", source: "open", slack })).resolves.toMatchObject({ messages: 0, seen: 2 });
    expect(finished(service)).toMatchObject({ messages_recovered: 0, messages_seen: 2 });
  });

  it("fetches replies only for threads where Slack has more than we do", async () => {
    world.bronzeReplies = [
      { thread_ts: "310.0", message_ts: "310.0" }, // the root itself isn't a reply
      { thread_ts: "310.0", message_ts: "310.1" },
      { thread_ts: "310.0", message_ts: "310.2" },
    ];
    const slack = slackStub({
      history: [slackMessage("310.0", { reply_count: 2 }), slackMessage("311.0", { reply_count: 1 })],
      replies: { "311.0": [slackMessage("311.0", { reply_count: 1 }), slackMessage("311.1", { thread_ts: "311.0" })] },
    });

    await catchUpChannel(fakeService(answer), { channelId: "C1", source: "open", slack });

    expect(slack.conversations.replies).toHaveBeenCalledTimes(1);
    expect(slack.conversations.replies).toHaveBeenCalledWith(expect.objectContaining({ ts: "311.0" }));
  });

  it("looks back a day when nothing is stored for the conversation yet", async () => {
    setClock({ now: () => 1_700_000_000_000, sleep: async () => {} });
    const slack = slackStub();
    await catchUpChannel(fakeService(answer), { channelId: "C1", source: "open", slack });
    expect(slack.conversations.history).toHaveBeenCalledWith({ channel: "C1", oldest: String(1_700_000_000 - 24 * 60 * 60), limit: 100 });
    setClock(systemClock);
  });

  it("fetches the replies of at most ten threads", async () => {
    const history = Array.from({ length: 12 }, (_, i) => slackMessage(`30${i}.0`, { reply_count: 1 }));
    const slack = slackStub({ history });
    await catchUpChannel(fakeService(answer), { channelId: "C1", source: "open", slack });
    expect(slack.conversations.replies).toHaveBeenCalledTimes(10);
  });

  it("records the failure when the bot isn't in the conversation, and never throws", async () => {
    const slack = slackStub();
    slack.conversations.history.mockRejectedValue({ data: { error: "not_in_channel" } });
    const service = fakeService(answer);
    await expect(catchUpChannel(service, { channelId: "C1", source: "open", slack })).resolves.toMatchObject({ claimed: true, error: "not_in_channel" });
    expect(finished(service)).toMatchObject({ error: "not_in_channel" });
  });
});

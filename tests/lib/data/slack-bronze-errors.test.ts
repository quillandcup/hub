import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseSlackMessageRepository } from "@/lib/data/slack-messages";
import { SupabaseSlackWorkspaceRepository } from "@/lib/data/slack-workspace";

/** A client whose every query answers with a database error: the repositories must throw it, not return an empty result. */
function failingDb(code?: string): Db {
  const answer = { data: null, error: { message: "database is down", code }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "gte", "lte", "is", "or", "not", "order", "range", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  const client = { from: () => chain, schema: () => client };
  return client as unknown as Db;
}

describe("SupabaseSlackWorkspaceRepository on a database error", () => {
  const repo = new SupabaseSlackWorkspaceRepository(failingDb());

  it.each([
    ["channels", () => repo.channels()],
    ["channelById", () => repo.channelById("C1")],
    ["channelIdByName", () => repo.channelIdByName("general")],
    ["publicChannelNames", () => repo.publicChannelNames(["C1"])],
    ["ignoredUserIds", () => repo.ignoredUserIds()],
    ["ignoreUser", () => repo.ignoreUser("U1", "bot")],
    ["restrictedChannels", () => repo.restrictedChannels()],
    ["restrictChannel", () => repo.restrictChannel("C1", "secret")],
    ["unrestrictChannel", () => repo.unrestrictChannel("C1")],
    ["upsertChannels", () => repo.upsertChannels([{ channel_id: "C1", name: "general", raw_payload: {} }])],
    ["memberships", () => repo.memberships()],
    ["upsertMemberships", () => repo.upsertMemberships([{ channel_id: "C1", user_id: "U1", left_at: null, imported_at: "2026-01-01T00:00:00Z" }])],
    ["markMembersLeft", () => repo.markMembersLeft("C1", ["U1"], "2026-01-01T00:00:00Z")],
    ["markMemberLeft", () => repo.markMemberLeft("C1", "U1", "2026-01-01T00:00:00Z")],
    ["recordMemberEvents", () => repo.recordMemberEvents([{ channel_id: "C1", user_id: "U1", event: "joined", occurred_at: "2026-01-01T00:00:00Z", source: "webhook" }])],
    ["lastMemberEvents", () => repo.lastMemberEvents()],
    ["upsertEmoji", () => repo.upsertEmoji([{ name: "wave" }])],
    ["liveEmojiNames", () => repo.liveEmojiNames()],
    ["markEmojiRemoved", () => repo.markEmojiRemoved(["wave"], "2026-01-01T00:00:00Z")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("treats a unique violation as already done", async () => {
    const duplicate = new SupabaseSlackWorkspaceRepository(failingDb("23505"));
    await expect(duplicate.ignoreUser("U1", "bot")).resolves.toBeUndefined();
    await expect(duplicate.restrictChannel("C1", "secret")).resolves.toBeUndefined();
  });
});

describe("SupabaseSlackMessageRepository on a database error", () => {
  const repo = new SupabaseSlackMessageRepository(failingDb());

  it.each([
    ["messageCountsByUser", () => repo.messageCountsByUser()],
    ["lastImportedAt", () => repo.lastImportedAt()],
    ["liveMessagesBetween", () => repo.liveMessagesBetween("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")],
    ["liveReactionsBetween", () => repo.liveReactionsBetween("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")],
    ["liveMessageTimes", () => repo.liveMessageTimes()],
    ["upsertMessages", () => repo.upsertMessages([{ channel_id: "C1", message_ts: "1.1", user_id: "U1", occurred_at: "2026-01-01T00:00:00Z", raw_payload: {} }])],
    ["upsertReactions", () => repo.upsertReactions([{ channel_id: "C1", message_ts: "1.1", user_id: "U1", reaction: "tada", occurred_at: "2026-01-01T00:00:00Z", raw_payload: {} }])],
    ["editMessage", () => repo.editMessage("C1", "1.1", { text: "x", edited_at: null, reply_count: 0, reply_users_count: 0, files: null, raw_payload: {} })],
    ["markMessagesDeleted", () => repo.markMessagesDeleted("C1", ["1.1"], "2026-01-01T00:00:00Z")],
    ["markReactionRemoved", () => repo.markReactionRemoved({ channel_id: "C1", message_ts: "1.1", user_id: "U1", reaction: "tada" }, "2026-01-01T00:00:00Z")],
    ["storedMessagesBetween", () => repo.storedMessagesBetween("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")],
    ["liveReactionsOn", () => repo.liveReactionsOn("C1", ["1.1"])],
    ["threadMessages", () => repo.threadMessages("C1", ["1.1"])],
    ["hasLiveActivityBetween", () => repo.hasLiveActivityBetween("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

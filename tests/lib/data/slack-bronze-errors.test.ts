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
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

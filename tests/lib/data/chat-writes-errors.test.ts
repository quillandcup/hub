import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseChatRepository } from "@/lib/data/chat";

/** A client whose every query and rpc answers with a database error: the repository must throw it, not return an empty result. */
function failingDb(): Db {
  const answer = { data: null, error: { message: "database is down" } };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "in", "is", "lt", "lte", "gt", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain, rpc: async () => answer } as unknown as Db;
}

describe("SupabaseChatRepository message writes", () => {
  const repo = new SupabaseChatRepository(failingDb());
  const window = { createdBefore: "2026-01-02T00:00:00Z", createdAfter: "2026-01-01T00:00:00Z", limit: 5 };

  it.each([
    ["slackTarget", () => repo.slackTarget("msg_AAAAAAAAAAA1")],
    ["outboxMessage", () => repo.outboxMessage("msg_AAAAAAAAAAA1")],
    ["markSent", () => repo.markSent("msg_AAAAAAAAAAA1", "1.1")],
    ["markFailed", () => repo.markFailed("msg_AAAAAAAAAAA1")],
    ["setPostedVia", () => repo.setPostedVia("msg_AAAAAAAAAAA1", "bot")],
    ["expireStalePending", () => repo.expireStalePending("2026-01-01T00:00:00Z")],
    ["unsentMessageIds", () => repo.unsentMessageIds(window)],
    ["markReactionSynced", () => repo.markReactionSynced({ messageId: "msg_AAAAAAAAAAA1", emoji: "tada", memberId: "mbr_AAAAAAAAAAA1" })],
    ["appMessageAuthor", () => repo.appMessageAuthor("msg_AAAAAAAAAAA1")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseConversationRepository } from "@/lib/data/conversations";
import { failingDb } from "@/tests/helpers/people-fixtures";

const [member, id, at] = ["mbr_AAAAAAAAAAA1", "conv_AAAAAAAAAAA1", "2026-03-01T15:00:00.000Z"];

/** A client that records each query's calls and answers the n-th `from()` with the n-th prepared answer. */
function scriptedDb(answers: { data: unknown; error: { message: string; code?: string } | null }[]) {
  const queries: { table: string; calls: { method: string; args: unknown[] }[] }[] = [];
  const db = {
    from(table: string) {
      const answer = answers[queries.length] ?? { data: null, error: null };
      const query = { table, calls: [] as { method: string; args: unknown[] }[] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "eq", "is", "or", "order", "range"]) {
        chain[m] = (...args: unknown[]) => {
          query.calls.push({ method: m, args });
          return chain;
        };
      }
      chain.single = async () => answer;
      chain.maybeSingle = async () => answer;
      chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
      return chain;
    },
  } as unknown as Db;
  return { db, queries };
}

describe("SupabaseConversationRepository database errors", () => {
  const repo = new SupabaseConversationRepository(failingDb());

  it.each([
    ["list", () => repo.list()],
    ["forMember", () => repo.forMember(member)],
    ["byId", () => repo.byId(id)],
    ["open", () => repo.open({ memberId: member, reason: "hello", channel: "slack_dm", openedBy: null })],
    ["logMessage", () => repo.logMessage(id, "member", at)],
    ["update", () => repo.update(id, { notes: "x" })],
    ["update with nothing to change", () => repo.update(id, {})],
    ["close", () => repo.close(id, "resolved", at)],
    ["softDelete", () => repo.softDelete(id, at)],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

describe("SupabaseConversationRepository queries", () => {
  it("lists open ones only when no closed window is given, and open plus recently closed when it is", async () => {
    const only = scriptedDb([{ data: [], error: null }]);
    await new SupabaseConversationRepository(only.db).list();
    expect(only.queries[0].calls.map((c) => c.method)).not.toContain("or");
    expect(only.queries[0].calls).toContainEqual({ method: "is", args: ["closed_at", null] });

    const window = scriptedDb([{ data: [], error: null }]);
    await new SupabaseConversationRepository(window.db).list({ closedSince: at });
    expect(window.queries[0].calls).toContainEqual({ method: "or", args: [`closed_at.is.null,closed_at.gte.${at}`] });
  });

  it("takes a to-one member embed given as an object or as a one-item array", async () => {
    const m = { id: member, name: "Ada Example", display_name: null };
    const row = { id, member_id: member, closed_at: null };
    const objectEmbed = scriptedDb([{ data: [{ ...row, member: m }], error: null }]);
    const arrayEmbed = scriptedDb([{ data: [{ ...row, member: [m] }], error: null }]);
    const missing = scriptedDb([{ data: [{ ...row, member: null }], error: null }]);

    expect((await new SupabaseConversationRepository(objectEmbed.db).list())[0].member).toEqual(m);
    expect((await new SupabaseConversationRepository(arrayEmbed.db).list())[0].member).toEqual(m);
    expect((await new SupabaseConversationRepository(missing.db).list())[0].member).toBeNull();
  });

  it("finds one by id with its member joined in", async () => {
    const m = { id: member, name: "Ada Example", display_name: "Ada E." };
    const { db, queries } = scriptedDb([{ data: { id, member_id: member, member: m }, error: null }]);

    expect(await new SupabaseConversationRepository(db).byId(id)).toMatchObject({ id, member: m });
    expect(queries[0].calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("answers an unknown id with null", async () => {
    const { db } = scriptedDb([{ data: null, error: null }]);
    expect(await new SupabaseConversationRepository(db).byId(id)).toBeNull();
  });

  it("answers a duplicate open conversation with the one that is open", async () => {
    const existing = { id, member_id: member, channel: "slack_dm" };
    const { db, queries } = scriptedDb([
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: existing, error: null },
    ]);

    const result = await new SupabaseConversationRepository(db).open({ memberId: member, reason: "hello", channel: "slack_dm", openedBy: null });

    expect(result).toEqual({ ok: false, reason: "already_open", conversation: existing });
    expect(queries[1].calls).toContainEqual({ method: "eq", args: ["member_id", member] });
    expect(queries[1].calls).toContainEqual({ method: "eq", args: ["channel", "slack_dm"] });
  });

  it("throws the original error when the open conversation is gone by the time it looks", async () => {
    const { db } = scriptedDb([
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: null, error: null },
    ]);
    await expect(new SupabaseConversationRepository(db).open({ memberId: member, reason: "hello", channel: "slack_dm", openedBy: null })).rejects.toThrow("duplicate key value");
  });

  it("throws when looking up the open conversation fails", async () => {
    const { db } = scriptedDb([
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: null, error: { message: "lookup failed" } },
    ]);
    await expect(new SupabaseConversationRepository(db).open({ memberId: member, reason: "hello", channel: "slack_dm", openedBy: null })).rejects.toThrow("lookup failed");
  });

  it("opens with her message at the start unless the member wrote first", async () => {
    const hers = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseConversationRepository(hers.db).open({ memberId: member, reason: "hello", channel: "email", openedBy: null, openedAt: at });
    expect(hers.queries[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ last_staff_message_at: at, last_member_message_at: null })] });

    const theirs = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseConversationRepository(theirs.db).open({ memberId: member, reason: "hello", channel: "email", openedBy: null, openedAt: at, firstMessageFrom: "member" });
    expect(theirs.queries[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ last_staff_message_at: null, last_member_message_at: at })] });
  });

  it("reads instead of updating when there is nothing to change, and updates only what is given otherwise", async () => {
    const none = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseConversationRepository(none.db).update(id, {});
    expect(none.queries[0].calls.map((c) => c.method)).not.toContain("update");

    const some = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseConversationRepository(some.db).update(id, { reason: "welcome", nextStep: null, followUpOn: "2026-03-08", notes: "n" });
    expect(some.queries[0].calls[0]).toEqual({ method: "update", args: [{ reason: "welcome", next_step: null, follow_up_on: "2026-03-08", notes: "n" }] });
  });

  it("logs a message on the right column, only on an open conversation", async () => {
    const m = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseConversationRepository(m.db).logMessage(id, "member", at);
    expect(m.queries[0].calls[0]).toEqual({ method: "update", args: [{ last_member_message_at: at }] });
    expect(m.queries[0].calls).toContainEqual({ method: "is", args: ["closed_at", null] });

    const s = scriptedDb([{ data: null, error: null }]);
    expect(await new SupabaseConversationRepository(s.db).logMessage(id, "staff", at)).toBeNull();
    expect(s.queries[0].calls[0]).toEqual({ method: "update", args: [{ last_staff_message_at: at }] });
  });

  it("says whether a soft delete found a conversation", async () => {
    expect(await new SupabaseConversationRepository(scriptedDb([{ data: { id }, error: null }]).db).softDelete(id, at)).toBe(true);
    expect(await new SupabaseConversationRepository(scriptedDb([{ data: null, error: null }]).db).softDelete(id, at)).toBe(false);
  });
});

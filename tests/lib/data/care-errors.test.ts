import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCareRepository } from "@/lib/data/care";
import { failingDb } from "@/tests/helpers/people-fixtures";

const [member, id, at] = ["mbr_AAAAAAAAAAA1", "care_AAAAAAAAAAA1", "2026-03-01T15:00:00.000Z"];

/** A client that records each query's calls and answers the n-th `from()` with the n-th prepared answer. */
function scriptedDb(answers: { data: unknown; error: { message: string; code?: string } | null }[]) {
  const queries: { table: string; calls: { method: string; args: unknown[] }[] }[] = [];
  const db = {
    rpc(name: string, args: unknown) {
      const answer = answers[queries.length] ?? { data: null, error: null };
      queries.push({ table: `rpc:${name}`, calls: [{ method: "args", args: [args] }] });
      return Promise.resolve(answer);
    },
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

describe("SupabaseCareRepository database errors", () => {
  const repo = new SupabaseCareRepository(failingDb());

  it.each([
    ["list", () => repo.list()],
    ["forMember", () => repo.forMember(member)],
    ["byId", () => repo.byId(id)],
    ["open", () => repo.open({ memberId: member, reason: "welcome", channel: "slack_dm", openedBy: null, periodEndsOn: "2026-03-31" })],
    ["logMessage", () => repo.logMessage(id, "member", at)],
    ["moveMessageTimesForward", () => repo.moveMessageTimesForward(id, { staffAt: at })],
    ["update", () => repo.update(id, { notes: "x" })],
    ["update with nothing to change", () => repo.update(id, {})],
    ["renew", () => repo.renew(id, { periodEndsOn: "2026-05-01", openedBy: null, at, reason: "a plan" })],
    ["close", () => repo.close(id, "no_reply", at)],
    ["softDelete", () => repo.softDelete(id, at)],
    ["reassign", () => repo.reassign(id, "11111111-1111-4111-8111-111111111111")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

describe("SupabaseCareRepository queries", () => {
  it("lists open ones only unless closed ones are asked for", async () => {
    const only = scriptedDb([{ data: [], error: null }]);
    await new SupabaseCareRepository(only.db).list();
    expect(only.queries[0].calls).toContainEqual({ method: "is", args: ["closed_at", null] });

    const all = scriptedDb([{ data: [], error: null }]);
    await new SupabaseCareRepository(all.db).list({ includeClosed: true });
    expect(all.queries[0].calls).not.toContainEqual({ method: "is", args: ["closed_at", null] });
    expect(all.queries[0].calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("renews through the function and answers the new period, or not_open when the function returns no row", async () => {
    const next = { id: "care_AAAAAAAAAAA2", renewed_from: id };
    const renewed = scriptedDb([{ data: [next], error: null }]);
    expect(await new SupabaseCareRepository(renewed.db).renew(id, { periodEndsOn: "2026-05-01", openedBy: "11111111-1111-4111-8111-111111111111", at, reason: "a plan" })).toEqual({ ok: true, engagement: next });
    expect(renewed.queries[0]).toEqual({
      table: "rpc:renew_care_engagement",
      calls: [{ method: "args", args: [{ p_id: id, p_period_ends_on: "2026-05-01", p_opened_by: "11111111-1111-4111-8111-111111111111", p_at: at, p_notes: "a plan" }] }],
    });

    const again = scriptedDb([{ data: [], error: null }]);
    expect(await new SupabaseCareRepository(again.db).renew(id, { periodEndsOn: "2026-05-01", openedBy: null, at, reason: "a plan" })).toEqual({ ok: false, reason: "not_open" });
  });

  it("takes a to-one member embed given as an object or as a one-item array", async () => {
    const m = { id: member, name: "Ada Example", display_name: null };
    const row = { id, member_id: member, closed_at: null };
    const objectEmbed = scriptedDb([{ data: [{ ...row, member: m }], error: null }]);
    const arrayEmbed = scriptedDb([{ data: [{ ...row, member: [m] }], error: null }]);
    const missing = scriptedDb([{ data: [{ ...row, member: null }], error: null }]);

    expect((await new SupabaseCareRepository(objectEmbed.db).list())[0].member).toEqual(m);
    expect((await new SupabaseCareRepository(arrayEmbed.db).list())[0].member).toEqual(m);
    expect((await new SupabaseCareRepository(missing.db).list())[0].member).toBeNull();
  });

  it("finds one by id with its member joined in", async () => {
    const m = { id: member, name: "Ada Example", display_name: "Ada E." };
    const { db, queries } = scriptedDb([{ data: { id, member_id: member, member: m }, error: null }]);

    expect(await new SupabaseCareRepository(db).byId(id)).toMatchObject({ id, member: m });
    expect(queries[0].calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("answers an unknown id with null", async () => {
    const { db } = scriptedDb([{ data: null, error: null }]);
    expect(await new SupabaseCareRepository(db).byId(id)).toBeNull();
  });

  it("answers a duplicate open engagement with the one that is open", async () => {
    const existing = { id, member_id: member, channel: "slack_dm" };
    const { db, queries } = scriptedDb([
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: existing, error: null },
    ]);

    const result = await new SupabaseCareRepository(db).open({ memberId: member, reason: "welcome", channel: "slack_dm", openedBy: null, periodEndsOn: "2026-03-31" });

    expect(result).toEqual({ ok: false, reason: "already_open", engagement: existing });
    expect(queries[1].calls).toContainEqual({ method: "eq", args: ["member_id", member] });
    expect(queries[1].calls).toContainEqual({ method: "eq", args: ["channel", "slack_dm"] });
  });

  it("throws the original error when the open engagement is gone by the time it looks", async () => {
    const { db } = scriptedDb([
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: null, error: null },
    ]);
    await expect(new SupabaseCareRepository(db).open({ memberId: member, reason: "welcome", channel: "slack_dm", openedBy: null, periodEndsOn: "2026-03-31" })).rejects.toThrow("duplicate key value");
  });

  it("throws when looking up the open engagement fails", async () => {
    const { db } = scriptedDb([
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: null, error: { message: "lookup failed" } },
    ]);
    await expect(new SupabaseCareRepository(db).open({ memberId: member, reason: "welcome", channel: "slack_dm", openedBy: null, periodEndsOn: "2026-03-31" })).rejects.toThrow("lookup failed");
  });

  it("opens with her message at the start unless the member wrote first", async () => {
    const hers = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(hers.db).open({ memberId: member, reason: "welcome", channel: "email", openedBy: null, periodEndsOn: "2026-03-31", openedAt: at });
    expect(hers.queries[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ last_staff_message_at: at, last_member_message_at: null })] });

    const theirs = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(theirs.db).open({ memberId: member, reason: "welcome", channel: "email", openedBy: null, periodEndsOn: "2026-03-31", openedAt: at, firstMessageFrom: "member" });
    expect(theirs.queries[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ last_staff_message_at: null, last_member_message_at: at })] });
  });

  it("reads instead of updating when there is nothing to change, and updates only what is given otherwise", async () => {
    const none = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(none.db).update(id, {});
    expect(none.queries[0].calls.map((c) => c.method)).not.toContain("update");

    const some = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(some.db).update(id, { reason: "welcome", nextStep: null, followUpOn: "2026-03-08", notes: "n" });
    expect(some.queries[0].calls[0]).toEqual({ method: "update", args: [{ reason: "welcome", next_step: null, follow_up_on: "2026-03-08", notes: "n" }] });
  });

  it("logs a message on the right column, only on an open engagement", async () => {
    const m = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(m.db).logMessage(id, "member", at);
    expect(m.queries[0].calls[0]).toEqual({ method: "update", args: [{ last_member_message_at: at }] });
    expect(m.queries[0].calls).toContainEqual({ method: "is", args: ["closed_at", null] });

    const s = scriptedDb([{ data: null, error: null }]);
    expect(await new SupabaseCareRepository(s.db).logMessage(id, "staff", at)).toBeNull();
    expect(s.queries[0].calls[0]).toEqual({ method: "update", args: [{ last_staff_message_at: at }] });
  });

  it("moves a time forward only where it is later or none is stored, on an open engagement, and counts what moved", async () => {
    const both = scriptedDb([{ data: { id }, error: null }, { data: null, error: null }]);
    expect(await new SupabaseCareRepository(both.db).moveMessageTimesForward(id, { staffAt: at, memberAt: at })).toBe(1);
    expect(both.queries[0].calls[0]).toEqual({ method: "update", args: [{ last_staff_message_at: at }] });
    expect(both.queries[0].calls).toContainEqual({ method: "or", args: [`last_staff_message_at.is.null,last_staff_message_at.lt.${at}`] });
    expect(both.queries[0].calls).toContainEqual({ method: "is", args: ["closed_at", null] });
    expect(both.queries[1].calls[0]).toEqual({ method: "update", args: [{ last_member_message_at: at }] });

    const none = scriptedDb([]);
    expect(await new SupabaseCareRepository(none.db).moveMessageTimesForward(id, {})).toBe(0);
    expect(none.queries).toEqual([]);
  });

  it("hands an engagement over on any engagement that is not removed, and answers null when there is none", async () => {
    const owner = "22222222-2222-4222-8222-222222222222";
    const handed = scriptedDb([{ data: { id, owned_by: owner }, error: null }]);
    expect(await new SupabaseCareRepository(handed.db).reassign(id, owner)).toEqual({ id, owned_by: owner });
    expect(handed.queries[0].calls[0]).toEqual({ method: "update", args: [{ owned_by: owner }] });
    expect(handed.queries[0].calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(handed.queries[0].calls.some((c) => c.method === "is" && c.args[0] === "closed_at")).toBe(false);

    expect(await new SupabaseCareRepository(scriptedDb([{ data: null, error: null }]).db).reassign(id, null)).toBeNull();
  });

  it("opens with the owner given, or whoever opened it when none is named", async () => {
    const named = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(named.db).open({ memberId: member, reason: "welcome", channel: "email", openedBy: "u1", ownedBy: "u2", periodEndsOn: "2026-03-31" });
    expect(named.queries[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ opened_by: "u1", owned_by: "u2" })] });

    const unnamed = scriptedDb([{ data: { id }, error: null }]);
    await new SupabaseCareRepository(unnamed.db).open({ memberId: member, reason: "welcome", channel: "email", openedBy: "u1", periodEndsOn: "2026-03-31" });
    expect(unnamed.queries[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ owned_by: "u1" })] });
  });

  it("says whether a soft delete found an engagement", async () => {
    expect(await new SupabaseCareRepository(scriptedDb([{ data: { id }, error: null }]).db).softDelete(id, at)).toBe(true);
    expect(await new SupabaseCareRepository(scriptedDb([{ data: null, error: null }]).db).softDelete(id, at)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMemberStatusRepository } from "@/lib/data/member-status-overrides";

/** A client whose every query answers with a database error: the repository must throw it, not return an empty result. */
function failingDb(): Db {
  const answer = { data: null, error: { message: "database is down" } };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "lte", "or", "order", "range"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain } as unknown as Db;
}

describe("SupabaseMemberStatusRepository database errors", () => {
  const repo = new SupabaseMemberStatusRepository(failingDb());
  const id = "mbr_AAAAAAAAAAA1";

  it.each([
    ["hiatusesOf", () => repo.hiatusesOf(id)],
    ["hiatusById", () => repo.hiatusById(id)],
    ["allHiatuses", () => repo.allHiatuses()],
    ["memberIdsOnHiatus", () => repo.memberIdsOnHiatus("2026-01-01")],
    ["createHiatus", () => repo.createHiatus({ member_id: id, start_date: "2026-01-01" })],
    ["updateHiatus", () => repo.updateHiatus(id, { reason: "x" })],
    ["deleteHiatus", () => repo.deleteHiatus(id)],
    ["statusOverridesOf", () => repo.statusOverridesOf(id)],
    ["allStatusOverrides", () => repo.allStatusOverrides()],
    ["statusOverridesWithMember", () => repo.statusOverridesWithMember()],
    ["createStatusOverride", () => repo.createStatusOverride({ member_id: id, override_type: "gift", reason: "r" })],
    ["updateStatusOverride", () => repo.updateStatusOverride(id, { notes: "x" })],
    ["deleteStatusOverride", () => repo.deleteStatusOverride(id)],
    ["reassignMember", () => repo.reassignMember(id, "mbr_AAAAAAAAAAA2")],
    ["joinDateOverrides", () => repo.joinDateOverrides()],
    ["profileOverrideOf", () => repo.profileOverrideOf(id)],
    ["profileOverrides", () => repo.profileOverrides()],
    ["saveProfileOverride", () => repo.saveProfileOverride(id, { bio: "x" }, "user")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabasePrickleRepository } from "@/lib/data/prickles";

/** A client whose every query answers with a database error: the repository must throw it, not return an empty result. */
function failingDb(): Db {
  const answer = { data: null, error: { message: "database is down" } };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "eq", "neq", "order", "range", "limit"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain } as unknown as Db;
}

describe("SupabasePrickleRepository prickle type queries", () => {
  const repo = new SupabasePrickleRepository(failingDb());

  it.each([
    ["types", () => repo.types()],
    ["typeById", () => repo.typeById("prty_AAAAAAAAAAA1")],
    ["typesRequiringHost", () => repo.typesRequiringHost()],
    ["typeIdByNormalizedName", () => repo.typeIdByNormalizedName("progress")],
    ["typeIdByNormalizedName excluding one", () => repo.typeIdByNormalizedName("progress", { excludingId: "prty_AAAAAAAAAAA1" })],
    ["createType", () => repo.createType({ name: "X", normalizedName: "x" })],
    ["updateType", () => repo.updateType("prty_AAAAAAAAAAA1", { requiresHost: true })],
    ["reassignDefaultHost", () => repo.reassignDefaultHost("mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("createType says so when the insert returns nothing and no error", async () => {
    const empty = { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["insert", "select"]) chain[m] = () => chain;
    chain.single = async () => empty;
    const quiet = new SupabasePrickleRepository({ from: () => chain } as unknown as Db);

    await expect(quiet.createType({ name: "X", normalizedName: "x" })).rejects.toThrow("Couldn't create the prickle type");
  });
});

import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { CommitmentConflictError, SupabasePrickleActivityRepository } from "@/lib/data/prickle-activity";
import { EMPTY_CHECKIN } from "@/lib/prickle-checkins";

/** A client whose every query answers with the given error: the repository must throw it, not return an empty result. */
function failingDb(error: { message: string; code?: string }): Db {
  const answer = { data: null, error, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "eq", "is", "in", "not", "gte", "order", "range"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain, rpc: async () => answer } as unknown as Db;
}

describe("SupabasePrickleActivityRepository database errors", () => {
  const repo = new SupabasePrickleActivityRepository(failingDb({ message: "database is down" }));
  const [m, p] = ["mbr_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA1"];

  it.each([
    ["commitmentsOf", () => repo.commitmentsOf(m)],
    ["commitmentOwner", () => repo.commitmentOwner("pcmt_AAAAAAAAAAA1")],
    ["createCommitment", () => repo.createCommitment({ memberId: m, startDate: "2097-01-05", weeks: 2, slots: [{ typeId: "ptyp_AAAAAAAAAAA1", dayOfWeek: 1, startTimeLocal: "07:00", timezone: "America/New_York" }] })],
    ["markCommitmentsCompleted", () => repo.markCommitmentsCompleted(["pcmt_AAAAAAAAAAA1"], "2097-01-01T00:00:00Z")],
    ["cancelCommitment", () => repo.cancelCommitment("pcmt_AAAAAAAAAAA1", m, "2097-01-01T00:00:00Z")],
    ["countActiveCommitments", () => repo.countActiveCommitments(m)],
    ["slotCommitments", () => repo.slotCommitments({ typeId: "ptyp_AAAAAAAAAAA1", dayOfWeek: 1, timezone: "America/New_York" })],
    ["checkinOf", () => repo.checkinOf(m, p)],
    ["checkinsOf", () => repo.checkinsOf(m)],
    ["checkinsAmong", () => repo.checkinsAmong(m, [p])],
    ["checkinsOfMembers", () => repo.checkinsOfMembers([m], [p])],
    ["ratedCheckinsOf", () => repo.ratedCheckinsOf(m)],
    ["saveCheckin (cleared)", () => repo.saveCheckin(m, p, EMPTY_CHECKIN, "web")],
    ["saveCheckin (answers)", () => repo.saveCheckin(m, p, { ...EMPTY_CHECKIN, pleasantBefore: 3 }, "web")],
    ["dismiss checkin", () => repo.dismiss("checkin", m, p)],
    ["dismiss checkout", () => repo.dismiss("checkout", m, p)],
    ["dismissedAmong", () => repo.dismissedAmong("checkin", m, [p])],
    ["dismissedSince", () => repo.dismissedSince("checkout", m, "2097-01-01T00:00:00Z")],
    ["dismissedPairs", () => repo.dismissedPairs("checkout", [p])],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("createCommitment reports an overlap as CommitmentConflictError, carrying the database's message", async () => {
    const taken = new SupabasePrickleActivityRepository(failingDb({ message: "Already committed", code: "23505" }));
    const error = await taken.createCommitment({ memberId: m, startDate: "2097-01-05", weeks: 2, slots: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(CommitmentConflictError);
    expect(error.message).toBe("Already committed");
  });
});

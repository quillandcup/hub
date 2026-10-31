import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAccessEventRepository } from "@/lib/data/access-events";
import { SupabasePrickleActivityRepository } from "@/lib/data/prickle-activity";
import { SupabasePrickleScheduleRepository } from "@/lib/data/prickle-schedules";
import { SupabasePrickleRepository } from "@/lib/data/prickles";
import { SupabaseWheelOfWonderRepository } from "@/lib/data/wheel-of-wonder";

/** A client whose every query answers with the given error: the repository must throw it, not return an empty result. */
function failingDb(error: { message: string; code?: string }): Db {
  const answer = { data: null, error, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "gte", "is", "not", "order", "range", "limit"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain } as unknown as Db;
}

const down = failingDb({ message: "database is down" });
const [m, p, t] = ["mbr_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA1", "ptyp_AAAAAAAAAAA1"];

describe("the hosting, wheel and page-view repositories on a database error", () => {
  const wheel = new SupabaseWheelOfWonderRepository(down);
  const schedules = new SupabasePrickleScheduleRepository(down);
  const prickles = new SupabasePrickleRepository(down);
  const activity = new SupabasePrickleActivityRepository(down);
  const access = new SupabaseAccessEventRepository(down);

  it.each([
    ["wheel recordProposed", () => wheel.recordProposed({ spinnerMemberId: m, matchedMemberId: m, slackChannelId: "C1", spinnerSlackUserId: null, matchedSlackUserId: null })],
    ["wheel proposedInChannel", () => wheel.proposedInChannel("C1")],
    ["wheel recordExchange", () => wheel.recordExchange("id", { spinnerMessageCount: 1, matchedMessageCount: 1 })],
    ["wheel confirmedCount", () => wheel.confirmedCount()],
    ["wheel recent", () => wheel.recent(10)],
    ["schedules scheduledTypesOf", () => schedules.scheduledTypesOf(m, "2097-01-01")],
    ["schedules locksOf", () => schedules.locksOf(["2097-01-01"])],
    ["schedules allLocks", () => schedules.allLocks()],
    ["schedules setLock", () => schedules.setLock({ month: "2097-01-01", locked: true, notes: null, lockedBy: null })],
    ["prickles hostedTypesSince", () => prickles.hostedTypesSince(m, "2097-01-01T00:00:00Z")],
    ["prickles hostVibes", () => prickles.hostVibes()],
    ["prickles hostVibes of some types", () => prickles.hostVibes({ hostId: m, typeIds: [t] })],
    ["prickles saveHostVibe", () => prickles.saveHostVibe({ typeId: t, hostId: m, vibe: "focused", notes: null, updatedBy: null })],
    ["prickles hostVibeCount", () => prickles.hostVibeCount(m)],
    ["activity claimDm", () => activity.claimDm(p, m, "prickle_checkin")],
    ["activity releaseDm", () => activity.releaseDm(p, m, "prickle_checkin")],
    ["activity claimedDmPairs", () => activity.claimedDmPairs("prickle_checkout", [p])],
    ["access events record", () => access.record({ user_id: "00000000-0000-4000-8000-000000000000", path: "/dashboard", is_page: true })],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("claimDm reads a unique violation as already claimed, not as an error", async () => {
    const taken = new SupabasePrickleActivityRepository(failingDb({ message: "duplicate key value", code: "23505" }));
    expect(await taken.claimDm(p, m, "prickle_checkout")).toBe(false);
  });
});

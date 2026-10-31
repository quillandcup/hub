import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseZoomRepository } from "@/lib/data/zoom";

/** A client whose every query answers with a database error: the repository must throw it, not return an empty result. */
function failingDb(): Db {
  const answer = { data: null, error: { message: "database is down" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "gte", "lt", "gt", "not", "order", "range", "limit", "contains"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  const client = { from: () => chain, schema: () => client };
  return client as unknown as Db;
}

describe("SupabaseZoomRepository on a database error", () => {
  const repo = new SupabaseZoomRepository(failingDb());

  it.each([
    ["attendeeCount", () => repo.attendeeCount()],
    ["attendeesForMatching", () => repo.attendeesForMatching()],
    ["attendeesForMatching with a meeting", () => repo.attendeesForMatching({ withMeetingOnly: true })],
    ["attendeesSince", () => repo.attendeesSince("2026-01-01T00:00:00Z")],
    ["attendeeNamesOverlapping", () => repo.attendeeNamesOverlapping("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")],
    ["attendeesOverlapping", () => repo.attendeesOverlapping("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")],
    ["appearancesOf", () => repo.appearancesOf(["Ada Example"])],
    ["meetingCountsByName", () => repo.meetingCountsByName(["Ada Example"])],
    ["meetingUuidsForName", () => repo.meetingUuidsForName("Ada Example")],
    ["attendeesInSessions", () => repo.attendeesInSessions(["m1"])],
    ["upsertAttendees", () => repo.upsertAttendees([{ meeting_id: "1", name: "Ada Example", join_time: "2026-01-01T00:00:00Z", leave_time: "2026-01-01T01:00:00Z", duration: 60 }])],
    ["latestMeetingStart", () => repo.latestMeetingStart()],
    ["upsertMeeting", () => repo.upsertMeeting({ meeting_uuid: "m1", meeting_id: "1", topic: "T", start_time: "2026-01-01T00:00:00Z", data: {} })],
    ["importedHostIds", () => repo.importedHostIds("2026-01-01T00:00:00Z")],
    ["ignoredNames", () => repo.ignoredNames()],
    ["ignoreName", () => repo.ignoreName({ zoomName: "Ada Example", reason: null, ignoredBy: null })],
    ["unignoreName", () => repo.unignoreName("Ada Example")],
    ["ignoredAppearances", () => repo.ignoredAppearances()],
    ["ignoredAppearancesOf", () => repo.ignoredAppearancesOf("prkl_AAAAAAAAAAA1")],
    ["ignoreAppearance", () => repo.ignoreAppearance({ prickleId: "prkl_AAAAAAAAAAA1", zoomName: "Ada Example", reason: null, ignoredBy: null })],
    ["unignoreAppearance", () => repo.unignoreAppearance("prkl_AAAAAAAAAAA1", "Ada Example")],
    ["unresolvedAmbiguousNames", () => repo.unresolvedAmbiguousNames()],
    ["hasUnresolvedAmbiguousName", () => repo.hasUnresolvedAmbiguousName("Ada Example")],
    ["resolveAmbiguousName", () => repo.resolveAmbiguousName("Ada Example", "mbr_AAAAAAAAAAA1")],
    ["ignoreAmbiguousName", () => repo.ignoreAmbiguousName("Ada Example")],
    ["reassignAmbiguousMember", () => repo.reassignAmbiguousMember("mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2")],
    [
      "recordParticipantEvent",
      () =>
        repo.recordParticipantEvent({ meeting_uuid: "m1", participant_key: "p1", event: "joined", event_time: "2026-01-01T00:00:00Z", raw_payload: {} }),
    ],
    ["participantEventsSince", () => repo.participantEventsSince("2026-01-01T00:00:00Z")],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("reassignAmbiguousMember throws when patching an entry's candidates fails", async () => {
    let patching = false;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "contains", "order", "range"]) chain[m] = () => chain;
    chain.update = (patch: Record<string, unknown>) => {
      patching = "candidate_member_ids" in patch;
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(patching ? { data: null, error: { message: "patch failed" } } : { data: [{ id: "a", candidate_member_ids: ["mbr_AAAAAAAAAAA1"] }], error: null });
    const db = { from: () => chain } as unknown as Db;
    await expect(new SupabaseZoomRepository(db).reassignAmbiguousMember("mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2")).rejects.toThrow("patch failed");
  });
});

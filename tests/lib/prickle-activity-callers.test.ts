import { describe, it, expect, vi, beforeEach } from "vitest";

// How the callers of PrickleActivityRepository behave when it answers or fails. The repository
// itself is covered by its contract (tests/lib/data, tests/api/data); here it is the in-memory twin,
// with a method made to throw where a failure path is under test.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({
  getUserTimezonePreference: vi.fn(async () => "America/New_York"),
  getUserSecondaryTimezone: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { cancelCommitment, createCommitment, getMyCommitments } from "@/app/(member)/my-prickles/commitment-actions";
import { getMyCheckin, getMyCheckins } from "@/app/(member)/prickles/checkin-actions";
import { dismissCheckinHalf, loadCheckins, loadDismissedIds, loadDismissedPairs, saveCheckinAnswer } from "@/lib/prickle-checkin-dms";
import { EMPTY_CHECKIN } from "@/lib/prickle-checkins";

const IDENTITY = { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false };
const [M, P] = ["mbr_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA1"];
const BEFORE = { ...EMPTY_CHECKIN, pleasantBefore: 3, energyBefore: 4, need: "company" as const };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  repos = createInMemoryRepos();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "ada@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("check-in reads for a page", () => {
  it("show what the repository holds", async () => {
    await repos.prickleActivity.saveCheckin(M, P, BEFORE, "web");
    expect(await getMyCheckin(P)).toEqual(BEFORE);
    expect(await getMyCheckins()).toEqual({ [P]: BEFORE });
  });

  it("show no check-in, and log, when the read fails", async () => {
    vi.spyOn(repos.prickleActivity, "checkinOf").mockRejectedValue(new Error("down"));
    vi.spyOn(repos.prickleActivity, "checkinsOf").mockRejectedValue(new Error("down"));
    expect(await getMyCheckin(P)).toBeNull();
    expect(await getMyCheckins()).toEqual({});
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("dismissed check-in and check-out offers", () => {
  it("are read per half, for one member or for the sender's batch", async () => {
    await repos.prickleActivity.dismiss("checkin", M, P);
    expect(await loadDismissedIds(repos, "checkin", M, [P])).toEqual(new Set([P]));
    expect(await loadDismissedIds(repos, "checkout", M, [P])).toEqual(new Set());
    expect(await loadDismissedPairs(repos, "checkin", [P])).toEqual(new Set([`${M}:${P}`]));
    expect(await loadDismissedPairs(repos, "checkin", [])).toEqual(new Set());
  });

  it("hide nothing, and log, when the page's read fails; a sender's read fails instead of guessing", async () => {
    vi.spyOn(repos.prickleActivity, "dismissedAmong").mockRejectedValue(new Error("down"));
    vi.spyOn(repos.prickleActivity, "dismissedPairs").mockRejectedValue(new Error("down"));
    expect(await loadDismissedIds(repos, "checkout", M, [P])).toEqual(new Set());
    expect(console.error).toHaveBeenCalled();
    await expect(loadDismissedPairs(repos, "checkout", [P])).rejects.toThrow("down");
  });

  it("are saved for either half and report a failed save", async () => {
    expect(await dismissCheckinHalf(repos, "checkout", M, P)).toBeNull();
    expect(await repos.prickleActivity.dismissedAmong("checkout", M, [P])).toEqual(new Set([P]));
    vi.spyOn(repos.prickleActivity, "dismiss").mockRejectedValue(new Error("down"));
    expect(await dismissCheckinHalf(repos, "checkin", M, P)).toBe("Couldn't dismiss that check-in");
    expect(await dismissCheckinHalf(repos, "checkout", M, P)).toBe("Couldn't dismiss that check-out");
  });
});

describe("check-ins the senders read", () => {
  it("come back keyed by member and prickle, and none when there is nobody to ask about", async () => {
    await repos.prickleActivity.saveCheckin(M, P, BEFORE, "slack");
    expect(await loadCheckins(repos, [M], [P])).toEqual(new Map([[`${M}:${P}`, BEFORE]]));
    expect(await loadCheckins(repos, [], [P])).toEqual(new Map());
  });
});

describe("saveCheckinAnswer", () => {
  const answer = { prickleId: P, field: "need" as const, values: ["company"] };

  it("saves an answer into the member's check-in", async () => {
    expect(await saveCheckinAnswer(repos, M, answer)).toBeNull();
    expect(await repos.prickleActivity.checkinOf(M, P)).toEqual({ ...EMPTY_CHECKIN, need: "company" });
  });

  it("reports a failed read, and a failed save, as a message", async () => {
    vi.spyOn(repos.prickleActivity, "checkinOf").mockRejectedValueOnce(new Error("down"));
    expect(await saveCheckinAnswer(repos, M, answer)).toBe("couldn't read check-in: down");
    vi.spyOn(repos.prickleActivity, "saveCheckin").mockRejectedValue(new Error("nope"));
    expect(await saveCheckinAnswer(repos, M, answer)).toBe("couldn't save check-in: nope");
  });
});

describe("commitment actions", () => {
  const TYPE = "ptyp_AAAAAAAAAAA1";
  const slot = { typeId: TYPE, dayOfWeek: 1, startTimeLocal: "07:00", timezone: "America/New_York" };

  it("show nothing, and log, when the member's commitments can't be read", async () => {
    vi.spyOn(repos.prickleActivity, "commitmentsOf").mockRejectedValue(new Error("down"));
    expect(await getMyCommitments()).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("still show the commitments when marking the expired ones completed fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2098-01-01T12:00:00Z"));
    repos = createInMemoryRepos(
      new InMemoryDataset({
        prickleTypes: [{ id: TYPE, name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
        prickleCommitments: [{ id: "pcmt_AAAAAAAAAAA1", memberId: M, startDate: "2097-01-05", weeks: 2, slots: [slot] }],
      }),
    );
    vi.spyOn(repos.prickleActivity, "markCommitmentsCompleted").mockRejectedValue(new Error("down"));
    const [commitment] = await getMyCommitments();
    expect(commitment.status).toBe("completed");
    expect(commitment.slots[0].typeName).toBe("Sprint");
    expect(console.error).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("tell the member a failed create or cancel didn't work, without the database's wording", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
    repos = createInMemoryRepos(
      new InMemoryDataset({
        prickleTypes: [{ id: TYPE, name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
        prickles: [{ id: P, typeId: TYPE, hostId: null, title: null, startTime: "2026-09-28T11:00:00Z", endTime: "2026-09-28T12:00:00Z", source: "calendar", calendarEventId: null }],
        prickleCommitments: [{ id: "pcmt_AAAAAAAAAAA1", memberId: M, startDate: "2026-09-21", weeks: 4, slots: [{ ...slot, startTimeLocal: "09:00" }] }],
      }),
    );
    vi.spyOn(repos.prickleActivity, "createCommitment").mockRejectedValueOnce(new Error("permission denied for table"));
    expect(await createCommitment({ slots: [slot], startDate: "2026-09-28", weeks: 4 })).toEqual({ error: "Failed to save commitment" });
    vi.spyOn(repos.prickleActivity, "cancelCommitment").mockRejectedValue(new Error("permission denied for table"));
    expect(await cancelCommitment("pcmt_AAAAAAAAAAA1")).toEqual({ error: "Couldn't cancel that commitment" });
    vi.useRealTimers();
  });

  it("create a commitment, refuse a clash with a friendly message, and cancel the member's own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
    repos = createInMemoryRepos(
      new InMemoryDataset({
        prickleTypes: [{ id: TYPE, name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
        prickles: [{ id: P, typeId: TYPE, hostId: null, title: null, startTime: "2026-09-28T11:00:00Z", endTime: "2026-09-28T12:00:00Z", source: "calendar", calendarEventId: null }],
      }),
    );
    const created = await createCommitment({ slots: [slot], startDate: "2026-09-28", weeks: 4 });
    expect(created).toEqual({ success: true, id: expect.any(String) });
    // The pre-check against existing commitments and the repository's own rule both say no.
    expect(await createCommitment({ slots: [slot], startDate: "2026-10-05", weeks: 2 })).toEqual({
      error: expect.stringContaining("already committed"),
    });
    vi.spyOn(repos.prickleActivity, "commitmentsOf").mockRejectedValueOnce(new Error("down"));
    expect(await createCommitment({ slots: [slot], startDate: "2026-10-05", weeks: 2 })).toEqual({
      error: "You're already committed to one of these prickles for those weeks",
    });
    if (!("id" in created)) throw new Error("not created");
    expect(await cancelCommitment(created.id)).toEqual({ success: true });
    expect(await cancelCommitment(created.id)).toEqual({ error: "Only active commitments can be cancelled" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "mbr_AAAAAAAAAAA2" } as never);
    expect(await cancelCommitment(created.id)).toEqual({ error: "Commitment not found" });
    vi.useRealTimers();
  });
});

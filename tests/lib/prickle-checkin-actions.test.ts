import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The actions scope every read/write to effectiveIdentity.memberId and rely on RLS (member or
// admin reads, owner-only writes -- see supabase/tests/database/prickle_checkins.test.sql). These
// tests cover the app-level sudo refusal, validation, and what is stored, on the in-memory twin.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ resolveAnsweredCheckinNotifications: vi.fn() }));
let repos: Repos;
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getCheckinForLogging, getMyCheckin, saveCheckin, saveCheckinHalf } from "@/app/(member)/prickles/checkin-actions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { resolveAnsweredCheckinNotifications } from "@/lib/prickle-checkin-dms";
import { EMPTY_CHECKIN, type CheckinInput } from "@/lib/prickle-checkins";

const USER = { id: "user-1", email: "m1@example.com" };
const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const CHECKIN: CheckinInput = { ...EMPTY_CHECKIN, pleasantBefore: 2, energyBefore: 1, emotionBefore: "anxious", need: "company" };
const EMPTY = EMPTY_CHECKIN;

/** A fresh twin, holding these saved check-ins (member, prickle, answers). */
function world(saved: { memberId: string; prickleId: string; checkin: CheckinInput }[] = []) {
  dataset = new InMemoryDataset({ prickleCheckins: saved });
  repos = createInMemoryRepos(dataset);
  return repos;
}

beforeEach(() => {
  vi.clearAllMocks();
  world();
  vi.mocked(getCurrentUser).mockResolvedValue(USER as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("saveCheckin", () => {
  it("saves the member's check-in for the prickle", async () => {
    expect(await saveCheckin("prickle-1", CHECKIN)).toEqual({ success: true });
    expect(dataset.prickleCheckins).toEqual([expect.objectContaining({ memberId: "member-1", prickleId: "prickle-1", checkin: CHECKIN, savedVia: "web" })]);
    expect(revalidatePath).toHaveBeenCalledWith("/prickles/prickle-1");
    // Resolves the in-app check-in/check-out notifications it answered (tested in prickle-checkin-dms).
    expect(resolveAnsweredCheckinNotifications).toHaveBeenCalledWith(repos, "member-1", "prickle-1", CHECKIN);
  });

  it("soft-deletes the live row when every answer is cleared", async () => {
    world([{ memberId: "member-1", prickleId: "prickle-1", checkin: CHECKIN }]);
    expect(await saveCheckin("prickle-1", EMPTY)).toEqual({ success: true });
    expect(await repos.prickleActivity.checkinOf("member-1", "prickle-1")).toBeNull();
    expect(dataset.prickleCheckins).toEqual([expect.objectContaining({ deletedAt: expect.any(String) })]);
  });

  it("refuses in sudo mode without touching the database", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await saveCheckin("prickle-1", CHECKIN)).toEqual({ error: "Check-ins aren't available in sudo mode." });
    expect(dataset.prickleCheckins).toEqual([]);
  });

  it("rejects invalid input", async () => {
    const result = await saveCheckin("prickle-1", { ...CHECKIN, need: "snacks" } as unknown as CheckinInput);
    expect(result).toEqual({ error: "Invalid intention" });
    expect(dataset.prickleCheckins).toEqual([]);
  });

  it("reports a database error", async () => {
    repos.prickleActivity.saveCheckin = async () => {
      throw new Error("boom");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveCheckin("prickle-1", CHECKIN)).toEqual({ error: "Couldn't save your check-in — please try again." });
  });
});

describe("getMyCheckin", () => {
  it("maps the stored row", async () => {
    const stored = { ...CHECKIN, intentionMet: 5, pleasantAfter: 4, energyAfter: 3, emotionAfter: "content" } as CheckinInput;
    world([
      { memberId: "member-1", prickleId: "prickle-1", checkin: stored },
      { memberId: "member-2", prickleId: "prickle-1", checkin: EMPTY },
    ]);
    expect(await getMyCheckin("prickle-1")).toEqual(stored);
  });

  it("reads the sudo'd member's check-in in sudo mode", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-2", isSudo: true } as never);
    world([
      { memberId: "member-1", prickleId: "prickle-1", checkin: CHECKIN },
      { memberId: "member-2", prickleId: "prickle-1", checkin: { ...EMPTY, emotionBefore: "sleepy" } },
    ]);
    expect(await getMyCheckin("prickle-1")).toEqual({ ...EMPTY, emotionBefore: "sleepy" });
  });
});

describe("getCheckinForLogging", () => {
  const mapped: CheckinInput = { ...EMPTY, emotionBefore: "sleepy" };

  it("returns the member's check-in, editable", async () => {
    world([{ memberId: "member-1", prickleId: "prickle-1", checkin: mapped }]);
    expect(await getCheckinForLogging("prickle-1")).toEqual({ checkin: mapped, canEdit: true });
  });

  it("is read-only in sudo, where saving is refused", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    world([{ memberId: "member-1", prickleId: "prickle-1", checkin: mapped }]);
    expect(await getCheckinForLogging("prickle-1")).toEqual({ checkin: mapped, canEdit: false });
  });

  it("is not editable when signed out", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await getCheckinForLogging("prickle-1")).toEqual({ checkin: null, canEdit: false });
  });
});

describe("saveCheckinHalf", () => {
  it("replaces only that half, keeping the other half as saved (e.g. answered meanwhile in Slack)", async () => {
    world([{ memberId: "member-1", prickleId: "prickle-1", checkin: CHECKIN }]);
    expect(await saveCheckinHalf("prickle-1", "checkout", { intentionMet: 4, pleasantAfter: 4, energyAfter: 2 })).toEqual({
      success: true,
    });
    expect(await repos.prickleActivity.checkinOf("member-1", "prickle-1")).toMatchObject({
      pleasantBefore: 2,
      need: "company",
      intentionMet: 4,
      pleasantAfter: 4,
      energyAfter: 2,
      emotionAfter: null,
    });
  });
});

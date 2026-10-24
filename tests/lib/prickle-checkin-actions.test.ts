import { describe, it, expect, vi, beforeEach } from "vitest";

// The actions scope every read/write to effectiveIdentity.memberId and rely on RLS (member or
// admin reads, owner-only writes -- see supabase/tests/database/prickle_checkins.test.sql). These
// tests cover the app-level sudo refusal, validation, and the query shape sent to Supabase.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ resolveAnsweredCheckinNotifications: vi.fn() }));

import { getCheckinForLogging, getMyCheckin, saveCheckin, saveCheckinHalf } from "@/app/(member)/prickles/checkin-actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { resolveAnsweredCheckinNotifications } from "@/lib/prickle-checkin-dms";
import { checkinToRow, EMPTY_CHECKIN, type CheckinInput } from "@/lib/prickle-checkins";

const USER = { id: "user-1", email: "m1@example.com" };
const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const CHECKIN: CheckinInput = { ...EMPTY_CHECKIN, pleasantBefore: 2, energyBefore: 1, emotionBefore: "anxious", need: "company" };
const EMPTY = EMPTY_CHECKIN;

function makeSupabase({ row = null as unknown, error = null as unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const updateIs = vi.fn().mockResolvedValue({ error });
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ is: updateIs })) })) }));
  const deleteFn = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const selectIs = vi.fn(() => ({ maybeSingle }));
  const selectEq2 = vi.fn(() => ({ is: selectIs }));
  const selectEq1 = vi.fn(() => ({ eq: selectEq2 }));
  const select = vi.fn(() => ({ eq: selectEq1 }));
  const from = vi.fn(() => ({ upsert, update, delete: deleteFn, select }));
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, upsert, update, updateIs, deleteFn, selectEq1, selectEq2, selectIs };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("saveCheckin", () => {
  it("upserts the member's check-in for the prickle", async () => {
    const sb = makeSupabase();
    expect(await saveCheckin("prickle-1", CHECKIN)).toEqual({ success: true });
    expect(sb.from).toHaveBeenCalledWith("prickle_checkins");
    expect(sb.upsert).toHaveBeenCalledWith(
      {
        member_id: "member-1",
        prickle_id: "prickle-1",
        pleasant_before: 2,
        energy_before: 1,
        emotion_before: "anxious",
        need: "company",
        intention_met: null,
        pleasant_after: null,
        energy_after: null,
        emotion_after: null,
        saved_via: "web",
        deleted_at: null,
      },
      { onConflict: "member_id,prickle_id" }
    );
    expect(revalidatePath).toHaveBeenCalledWith("/prickles/prickle-1");
    // Resolves the in-app check-in/check-out notifications it answered (tested in prickle-checkin-dms).
    expect(resolveAnsweredCheckinNotifications).toHaveBeenCalledWith({ from: sb.from }, "member-1", "prickle-1", CHECKIN);
  });

  it("soft-deletes the live row when every answer is cleared", async () => {
    const sb = makeSupabase();
    expect(await saveCheckin("prickle-1", EMPTY)).toEqual({ success: true });
    expect(sb.update).toHaveBeenCalledWith({ deleted_at: expect.any(String), saved_via: "web" });
    expect(sb.updateIs).toHaveBeenCalledWith("deleted_at", null);
    expect(sb.deleteFn).not.toHaveBeenCalled();
    expect(sb.upsert).not.toHaveBeenCalled();
  });

  it("refuses in sudo mode without touching the database", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    const sb = makeSupabase();
    expect(await saveCheckin("prickle-1", CHECKIN)).toEqual({ error: "Check-ins aren't available in sudo mode." });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const sb = makeSupabase();
    const result = await saveCheckin("prickle-1", { ...CHECKIN, need: "snacks" } as unknown as CheckinInput);
    expect(result).toEqual({ error: "Invalid intention" });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("reports a database error", async () => {
    makeSupabase({ error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveCheckin("prickle-1", CHECKIN)).toEqual({ error: "Couldn't save your check-in — please try again." });
  });
});

describe("getMyCheckin", () => {
  it("maps the stored row", async () => {
    const sb = makeSupabase({
      row: { ...checkinToRow(CHECKIN), intention_met: 5, pleasant_after: 4, energy_after: 3, emotion_after: "content" },
    });
    expect(await getMyCheckin("prickle-1")).toEqual({
      ...CHECKIN,
      intentionMet: 5,
      pleasantAfter: 4,
      energyAfter: 3,
      emotionAfter: "content",
    });
    expect(sb.selectEq1).toHaveBeenCalledWith("member_id", "member-1");
    expect(sb.selectEq2).toHaveBeenCalledWith("prickle_id", "prickle-1");
    expect(sb.selectIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("reads the sudo'd member's check-in in sudo mode", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-2", isSudo: true } as never);
    const sb = makeSupabase({
      row: checkinToRow({ ...EMPTY, emotionBefore: "sleepy" }),
    });
    expect(await getMyCheckin("prickle-1")).toEqual({ ...EMPTY, emotionBefore: "sleepy" });
    expect(sb.selectEq1).toHaveBeenCalledWith("member_id", "member-2");
  });
});

describe("getCheckinForLogging", () => {
  const mapped: CheckinInput = { ...EMPTY, emotionBefore: "sleepy" };
  const row = checkinToRow(mapped);

  it("returns the member's check-in, editable", async () => {
    makeSupabase({ row });
    expect(await getCheckinForLogging("prickle-1")).toEqual({ checkin: mapped, canEdit: true });
  });

  it("is read-only in sudo, where saving is refused", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    makeSupabase({ row });
    expect(await getCheckinForLogging("prickle-1")).toEqual({ checkin: mapped, canEdit: false });
  });

  it("is not editable when signed out", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await getCheckinForLogging("prickle-1")).toEqual({ checkin: null, canEdit: false });
  });
});

describe("saveCheckinHalf", () => {
  it("replaces only that half, keeping the other half as saved (e.g. answered meanwhile in Slack)", async () => {
    const sb = makeSupabase({ row: checkinToRow(CHECKIN) });
    expect(await saveCheckinHalf("prickle-1", "checkout", { intentionMet: 4, pleasantAfter: 4, energyAfter: 2 })).toEqual({
      success: true,
    });
    expect(sb.upsert.mock.calls[0][0]).toMatchObject({
      pleasant_before: 2,
      need: "company",
      intention_met: 4,
      pleasant_after: 4,
      energy_after: 2,
      emotion_after: null,
    });
  });
});

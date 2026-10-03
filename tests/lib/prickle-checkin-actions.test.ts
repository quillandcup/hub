import { describe, it, expect, vi, beforeEach } from "vitest";

// The actions scope every read/write to effectiveIdentity.memberId and rely on RLS (member or
// admin reads, owner-only writes -- see supabase/tests/database/prickle_checkins.test.sql). These
// tests cover the app-level sudo refusal, validation, and the query shape sent to Supabase.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getMyCheckin, saveCheckin } from "@/app/(member)/prickles/checkin-actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import type { CheckinInput } from "@/lib/prickle-checkins";

const USER = { id: "user-1", email: "m1@example.com" };
const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const CHECKIN: CheckinInput = { feelingsBefore: ["stressed"], need: "gentle", sessionRating: null, feelingsAfter: [] };
const EMPTY: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

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
        feelings_before: ["stressed"],
        need: "gentle",
        session_rating: null,
        feelings_after: [],
        deleted_at: null,
      },
      { onConflict: "member_id,prickle_id" }
    );
    expect(revalidatePath).toHaveBeenCalledWith("/prickles/prickle-1");
  });

  it("soft-deletes the live row when every answer is cleared", async () => {
    const sb = makeSupabase();
    expect(await saveCheckin("prickle-1", EMPTY)).toEqual({ success: true });
    expect(sb.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
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
    expect(result).toEqual({ error: "Invalid need" });
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
      row: { feelings_before: ["lonely"], need: "company", session_rating: 5, feelings_after: ["content"] },
    });
    expect(await getMyCheckin("prickle-1")).toEqual({
      feelingsBefore: ["lonely"],
      need: "company",
      sessionRating: 5,
      feelingsAfter: ["content"],
    });
    expect(sb.selectEq1).toHaveBeenCalledWith("member_id", "member-1");
    expect(sb.selectEq2).toHaveBeenCalledWith("prickle_id", "prickle-1");
    expect(sb.selectIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("reads the sudo'd member's check-in in sudo mode", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-2", isSudo: true } as never);
    const sb = makeSupabase({
      row: { feelings_before: ["drained"], need: null, session_rating: null, feelings_after: [] },
    });
    expect(await getMyCheckin("prickle-1")).toEqual({
      feelingsBefore: ["drained"],
      need: null,
      sessionRating: null,
      feelingsAfter: [],
    });
    expect(sb.selectEq1).toHaveBeenCalledWith("member_id", "member-2");
  });
});

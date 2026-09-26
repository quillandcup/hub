import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Server-action layer for Commitments: member_id always comes from effectiveIdentity (sudo-aware),
// input is validated before any write, only real schedule slots are accepted, and the
// member_activities mirror is best-effort. RLS on prickle_commitments is the real boundary; these
// tests cover the friendly app-level layer in front of it.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelCommitment, createCommitment } from "@/app/(member)/my-prickles/commitment-actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const SUDO_IDENTITY = { memberId: "sudo-target", memberName: "Target", memberEmail: "t@example.com", isSudo: true };

const TYPE = "type-progress";
const VALID_INPUT = {
  typeId: TYPE,
  dayOfWeek: 1,
  startTimeLocal: "07:00",
  timezone: "America/New_York",
  startDate: "2026-09-28",
  weeks: 4,
};
// Mon 2026-09-28 7am EDT
const MATCHING_PRICKLE = { id: "p1", type_id: TYPE, start_time: "2026-09-28T11:00:00+00:00", end_time: "2026-09-28T12:00:00+00:00" };

function chain(result: any) {
  const obj: any = {};
  for (const m of ["select", "eq", "in", "is", "gte", "lte", "order", "limit", "range"]) obj[m] = vi.fn(() => obj);
  obj.single = vi.fn().mockResolvedValue(result);
  obj.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

function makeSupabaseMock({
  prickles = [MATCHING_PRICKLE] as any[],
  existingActive = [] as any[],
  existingRow = null as any,
  insertError = undefined as string | undefined,
  activityError = undefined as string | undefined,
} = {}) {
  const commitmentInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi
        .fn()
        .mockResolvedValue(insertError ? { data: null, error: { message: insertError } } : { data: { id: "new-c" }, error: null }),
    })),
  }));
  const updateEqEq = vi.fn().mockResolvedValue({ error: null });
  const commitmentUpdate = vi.fn((_u: Record<string, unknown>) => ({ eq: vi.fn(() => ({ eq: updateEqEq })) }));
  const activityInsert = vi
    .fn()
    .mockResolvedValue(activityError ? { error: { message: activityError } } : { error: null });

  const from = vi.fn((table: string) => {
    if (table === "prickles") return chain({ data: prickles });
    if (table === "prickle_commitments") {
      // .single() -> the one-row lookup (cancel); awaited chain -> the active-duplicate lookup (create).
      const c = chain({ data: existingActive });
      c.single = vi.fn().mockResolvedValue({ data: existingRow });
      return { ...c, insert: commitmentInsert, update: commitmentUpdate };
    }
    if (table === "member_activities") return { insert: activityInsert };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, commitmentInsert, commitmentUpdate, updateEqEq, activityInsert };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T15:00:00Z")); // Sat 11am ET
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "auth-user-1", email: "m1@example.com" });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCommitment", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect(await createCommitment(VALID_INPUT)).toEqual({ error: "Not authenticated" });
    expect(mock.commitmentInsert).not.toHaveBeenCalled();
  });

  it("rejects an admin with no member record", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    expect(await createCommitment(VALID_INPUT)).toEqual({ error: "No member record" });
  });

  it.each([
    [{ weeks: 20 }, "Choose between 1 and 12 weeks"],
    [{ startDate: "2026-09-01" }, "Start date can't be in the past"],
    [{ dayOfWeek: -1 }, "Day of week must be between 0 and 6"],
  ])("rejects invalid input %o before touching the database", async (patch, message) => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await createCommitment({ ...VALID_INPUT, ...patch })).toEqual({ error: message });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("rejects a slot that isn't on the upcoming schedule", async () => {
    const mock = makeSupabaseMock({
      prickles: [{ ...MATCHING_PRICKLE, start_time: "2026-09-28T13:00:00+00:00" }], // 9am, not 7am
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await createCommitment(VALID_INPUT)).toEqual({
      error: "That prickle isn't on the upcoming schedule -- pick one from the list",
    });
    expect(mock.commitmentInsert).not.toHaveBeenCalled();
  });

  it("rejects a second active commitment to the same slot", async () => {
    const mock = makeSupabaseMock({
      existingActive: [
        {
          id: "c-old",
          type_id: TYPE,
          day_of_week: 1,
          start_time_local: "07:00:00",
          timezone: "America/New_York",
          start_date: "2026-09-21",
          weeks: 4,
          status: "active",
          cancelled_at: null,
        },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await createCommitment(VALID_INPUT)).toEqual({
      error: "You're already committed to this prickle through 2026-10-18",
    });
    expect(mock.commitmentInsert).not.toHaveBeenCalled();
  });

  it("marks an expired-but-still-active duplicate completed, then saves", async () => {
    const mock = makeSupabaseMock({
      existingActive: [
        {
          id: "c-old",
          type_id: TYPE,
          day_of_week: 1,
          start_time_local: "07:00:00",
          timezone: "America/New_York",
          start_date: "2026-08-03",
          weeks: 2,
          status: "active",
          cancelled_at: null,
        },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await createCommitment(VALID_INPUT)).toEqual({ success: true, id: "new-c" });
    expect(mock.commitmentUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(mock.commitmentInsert).toHaveBeenCalled();
  });

  it("saves for the effective member and logs a member activity", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await createCommitment(VALID_INPUT)).toEqual({ success: true, id: "new-c" });
    expect(mock.commitmentInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: "member-1",
        type_id: TYPE,
        day_of_week: 1,
        start_time_local: "07:00",
        timezone: "America/New_York",
        start_date: "2026-09-28",
        weeks: 4,
        status: "active",
        created_by: "auth-user-1",
      })
    );
    expect(mock.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: "member-1",
        activity_type: "prickle_commitment_created",
        source: "prickle_commitments",
        related_id: "new-c",
        actor_kind: "member",
        actor_user_id: null,
      })
    );
  });

  it("under sudo, saves for the sudo'd member and records the admin as a staff actor", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);

    await createCommitment(VALID_INPUT);
    expect(mock.commitmentInsert).toHaveBeenCalledWith(expect.objectContaining({ member_id: "sudo-target" }));
    expect(mock.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({ member_id: "sudo-target", actor_kind: "staff", actor_user_id: "auth-user-1" })
    );
  });

  it("still succeeds when the activity insert fails", async () => {
    const mock = makeSupabaseMock({ activityError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await createCommitment(VALID_INPUT)).toEqual({ success: true, id: "new-c" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("surfaces an insert error", async () => {
    const mock = makeSupabaseMock({ insertError: "duplicate key" });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await createCommitment(VALID_INPUT)).toEqual({ error: "duplicate key" });
    expect(mock.activityInsert).not.toHaveBeenCalled();
  });
});

describe("cancelCommitment", () => {
  it("refuses to cancel another member's commitment", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "c1", member_id: "someone-else", status: "active" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await cancelCommitment("c1")).toEqual({ error: "Commitment not found" });
    expect(mock.commitmentUpdate).not.toHaveBeenCalled();
  });

  it("refuses to cancel a commitment that isn't active", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "c1", member_id: "member-1", status: "completed" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await cancelCommitment("c1")).toEqual({ error: "Only active commitments can be cancelled" });
  });

  it("cancels the member's own active commitment", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "c1", member_id: "member-1", status: "active" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await cancelCommitment("c1")).toEqual({ success: true });
    expect(mock.commitmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", cancelled_at: "2026-09-26T15:00:00.000Z" })
    );
  });
});

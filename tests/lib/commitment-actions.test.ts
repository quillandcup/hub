import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Server-action layer for Commitments: member_id always comes from effectiveIdentity (sudo-aware),
// input is validated before any write, only real schedule slots are accepted, overlapping
// commitments get a friendly error, the commitment + its slots are created in one RPC, and the
// member_activities mirror is best-effort. RLS + the overlap trigger are the real boundary (see
// tests/api/commitments/rls.test.ts); these tests cover the app-level layer in front of them.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelCommitment, createCommitment, getMyCommitments } from "@/app/(member)/my-prickles/commitment-actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const SUDO_IDENTITY = { memberId: "sudo-target", memberName: "Target", memberEmail: "t@example.com", isSudo: true };

const TYPE = "type-progress";
const ET = "America/New_York";
const MON = { typeId: TYPE, dayOfWeek: 1, startTimeLocal: "07:00", timezone: ET };
const WED = { typeId: TYPE, dayOfWeek: 3, startTimeLocal: "07:00", timezone: ET };
const VALID_INPUT = { slots: [MON], startDate: "2026-09-28", weeks: 4 };
// Mon 2026-09-28 and Wed 2026-09-30, 7am EDT
const MON_PRICKLE = { id: "p1", type_id: TYPE, start_time: "2026-09-28T11:00:00+00:00", end_time: "2026-09-28T12:00:00+00:00" };
const WED_PRICKLE = { id: "p2", type_id: TYPE, start_time: "2026-09-30T11:00:00+00:00", end_time: "2026-09-30T12:00:00+00:00" };

type Result = { data: unknown; error?: unknown };

function chain(result: Result) {
  const obj: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "gte", "lte", "order", "limit"]) obj[m] = vi.fn(() => obj);
  // Paginated queries end in .range(); a second page (offset > 0) is empty.
  obj.range = vi.fn((from: number) => Promise.resolve(from === 0 ? result : { data: [] }));
  obj.single = vi.fn().mockResolvedValue(result);
  obj.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

function makeSupabaseMock({
  prickles = [MON_PRICKLE, WED_PRICKLE] as unknown[],
  commitments = [] as unknown[],
  attendance = [] as unknown[],
  existingRow = null as unknown,
  rpcError = undefined as { message: string; code?: string } | undefined,
  activityError = undefined as string | undefined,
} = {}) {
  const rpc = vi.fn().mockResolvedValue(rpcError ? { data: null, error: rpcError } : { data: "new-c", error: null });
  const updateEqEq = vi.fn().mockResolvedValue({ error: null });
  const commitmentUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: updateEqEq })), in: vi.fn(() => ({ eq: updateEqEq })) }));
  const activityInsert = vi.fn().mockResolvedValue(activityError ? { error: { message: activityError } } : { error: null });

  const from = vi.fn((table: string) => {
    if (table === "prickles") return chain({ data: prickles });
    if (table === "prickle_attendance") return chain({ data: attendance });
    if (table === "prickle_commitments") {
      const c = chain({ data: commitments });
      c.single = vi.fn().mockResolvedValue({ data: existingRow });
      return { ...c, update: commitmentUpdate };
    }
    if (table === "member_activities") return { insert: activityInsert };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, rpc, commitmentUpdate, activityInsert };
}

function commitmentRow(overrides: Record<string, unknown> = {}, slots = [MON]) {
  return {
    id: "c-old",
    start_date: "2026-09-21",
    weeks: 4,
    status: "active",
    cancelled_at: null,
    prickle_commitment_slots: slots.map((s) => ({
      type_id: s.typeId,
      day_of_week: s.dayOfWeek,
      start_time_local: `${s.startTimeLocal}:00`,
      timezone: s.timezone,
      prickle_types: { name: "Progress Prickle" },
    })),
    ...overrides,
  };
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
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect(await createCommitment(VALID_INPUT)).toEqual({ error: "Not authenticated" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects an admin with no member record", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    expect(await createCommitment(VALID_INPUT)).toEqual({ error: "No member record" });
  });

  it.each([
    [{ weeks: 20 }, "Choose between 1 and 12 weeks"],
    [{ startDate: "2026-09-01" }, "Start date can't be in the past"],
    [{ slots: [] }, "Pick at least one prickle to commit to"],
    [{ slots: [MON, { ...MON }] }, "The same prickle is picked twice"],
    [{ slots: [{ ...MON, dayOfWeek: -1 }] }, "Day of week must be between 0 and 6"],
  ])("rejects invalid input %o before touching the database", async (patch, message) => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment({ ...VALID_INPUT, ...patch })).toEqual({ error: message });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("rejects when any picked slot isn't on the upcoming schedule", async () => {
    const mock = makeSupabaseMock({ prickles: [MON_PRICKLE] }); // no Wednesday prickle
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment({ ...VALID_INPUT, slots: [MON, WED] })).toEqual({
      error: "One of those prickles isn't on the upcoming schedule -- pick from All Prickles",
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects a slot already in an active commitment with an overlapping window", async () => {
    const mock = makeSupabaseMock({ commitments: [commitmentRow({}, [WED])] }); // Wed, 9/21..10/18
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment({ ...VALID_INPUT, slots: [MON, WED] })).toEqual({
      error: "You're already committed to one of these prickles through 2026-10-18",
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("allows the same slot when the existing commitment's window ends before the new one starts (renewal)", async () => {
    const mock = makeSupabaseMock({ commitments: [commitmentRow({ start_date: "2026-08-31", weeks: 4 })] }); // ends 9/27
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment(VALID_INPUT)).toEqual({ success: true, id: "new-c" });
  });

  it("maps a unique_violation from the DB overlap trigger (a race) to a friendly error", async () => {
    const mock = makeSupabaseMock({ rpcError: { message: "Already committed", code: "23505" } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment(VALID_INPUT)).toEqual({
      error: "You're already committed to one of these prickles for those weeks",
    });
    expect(mock.activityInsert).not.toHaveBeenCalled();
  });

  it("creates a multi-slot commitment for the effective member in one RPC and logs a member activity", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment({ ...VALID_INPUT, slots: [MON, { ...WED, startTimeLocal: "07:00:00" }] })).toEqual({
      success: true,
      id: "new-c",
    });
    const expectedSlots = [
      { type_id: TYPE, day_of_week: 1, start_time_local: "07:00", timezone: ET },
      { type_id: TYPE, day_of_week: 3, start_time_local: "07:00", timezone: ET },
    ];
    expect(mock.rpc).toHaveBeenCalledWith("create_prickle_commitment", {
      p_member_id: "member-1",
      p_start_date: "2026-09-28",
      p_weeks: 4,
      p_slots: expectedSlots,
      p_created_by: "auth-user-1",
    });
    expect(mock.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: "member-1",
        activity_type: "prickle_commitment_created",
        source: "prickle_commitments",
        related_id: "new-c",
        title: "Committed to 2 prickles a week for 4 weeks",
        actor_kind: "member",
        actor_user_id: null,
        data: { start_date: "2026-09-28", weeks: 4, slots: expectedSlots },
      })
    );
  });

  it("under sudo, creates for the sudo'd member and records the admin as a staff actor", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);

    await createCommitment(VALID_INPUT);
    expect(mock.rpc).toHaveBeenCalledWith("create_prickle_commitment", expect.objectContaining({ p_member_id: "sudo-target" }));
    expect(mock.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({ member_id: "sudo-target", actor_kind: "staff", actor_user_id: "auth-user-1" })
    );
  });

  it("still succeeds when the activity insert fails", async () => {
    const mock = makeSupabaseMock({ activityError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await createCommitment(VALID_INPUT)).toEqual({ success: true, id: "new-c" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("surfaces any other RPC error", async () => {
    const mock = makeSupabaseMock({ rpcError: { message: "permission denied", code: "42501" } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await createCommitment(VALID_INPUT)).toEqual({ error: "permission denied" });
  });
});

describe("getMyCommitments", () => {
  it("returns per-slot and total progress, with slots in day order", async () => {
    vi.setSystemTime(new Date("2026-10-08T04:00:00Z")); // Thu 12am ET
    const mock = makeSupabaseMock({
      // Stored Wed first; returned Mon first.
      commitments: [commitmentRow({ start_date: "2026-09-28", weeks: 2 }, [WED, MON])],
      prickles: [
        MON_PRICKLE,
        WED_PRICKLE,
        { id: "p3", type_id: TYPE, start_time: "2026-10-05T11:00:00+00:00", end_time: "2026-10-05T12:00:00+00:00" },
        { id: "p4", type_id: TYPE, start_time: "2026-10-07T11:00:00+00:00", end_time: "2026-10-07T12:00:00+00:00" },
      ],
      // Two rows for p1 (left and rejoined) still count once.
      attendance: [{ prickle_id: "p1" }, { prickle_id: "p1" }, { prickle_id: "p3" }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const [c] = await getMyCommitments();
    expect(c.slots.map((s) => s.dayOfWeek)).toEqual([1, 3]);
    expect(c.title).toMatch(/^Progress Prickle · Mon, Wed · 7 AM E[DS]T$/);
    expect(c.slots.map((s) => s.progress.kept)).toEqual([2, 0]);
    expect({ kept: c.progress.kept, missed: c.progress.missed, pending: c.progress.pending }).toEqual({
      kept: 2,
      missed: 1,
      pending: 1,
    });
    expect(c.status).toBe("active");
    expect(c.endDate).toBe("2026-10-11");
  });
});

describe("cancelCommitment", () => {
  it("refuses to cancel another member's commitment", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "c1", member_id: "someone-else", status: "active" } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await cancelCommitment("c1")).toEqual({ error: "Commitment not found" });
    expect(mock.commitmentUpdate).not.toHaveBeenCalled();
  });

  it("refuses to cancel a commitment that isn't active", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "c1", member_id: "member-1", status: "completed" } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await cancelCommitment("c1")).toEqual({ error: "Only active commitments can be cancelled" });
  });

  it("cancels the member's own active commitment", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "c1", member_id: "member-1", status: "active" } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await cancelCommitment("c1")).toEqual({ success: true });
    expect(mock.commitmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", cancelled_at: "2026-09-26T15:00:00.000Z" })
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/lib/prickle-picker-actions.test.ts's approach: these actions
// scope every write to effectiveIdentity.memberId (never a client-passed id),
// and reject locked-month writes with a readable error before RLS would ever
// see them. RLS on prickle_schedules is the *real* authorization boundary
// (stricter than this codebase's usual permissive-RLS convention -- see the
// migration and tests/api/prickle-schedules/rls.test.ts), but these tests
// verify the friendly app-level layer in front of it.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requestToHost, updateMySchedule, withdrawMySchedule } from "@/app/(member)/hosting/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
  memberEmail: "m1@example.com",
  isSudo: false,
};

const SUDO_IDENTITY = {
  memberId: "sudo-target-member",
  memberName: "Sudo Target",
  memberEmail: "target@example.com",
  isSudo: true,
};

function chain(result: any) {
  const obj: any = {};
  const methods = ["select", "eq", "in", "is", "order", "limit"];
  for (const m of methods) obj[m] = vi.fn(() => obj);
  obj.single = vi.fn().mockResolvedValue(result);
  obj.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return obj;
}

function makeSupabaseMock({
  requiresHost = true,
  lockOverrides = [] as { month: string; locked: boolean }[],
  existingRow = null as any,
  writeError = undefined as string | undefined,
}) {
  const insert = vi.fn().mockResolvedValue(writeError ? { error: { message: writeError } } : { error: null });
  const updateEqEq = vi.fn().mockResolvedValue(writeError ? { error: { message: writeError } } : { error: null });
  const update = vi.fn((_updates: Record<string, unknown>) => ({ eq: vi.fn(() => ({ eq: updateEqEq })) }));

  const from = vi.fn((table: string) => {
    if (table === "prickle_types") {
      return chain({ data: { requires_host: requiresHost } });
    }
    if (table === "prickle_schedule_locks") {
      return chain({ data: lockOverrides });
    }
    if (table === "prickle_schedules") {
      return { ...chain({ data: existingRow }), insert, update };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-1" } } }) },
    from,
    __insert: insert,
    __update: update,
    __updateEqEq: updateEqEq,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestToHost", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock({});
    mock.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
    });
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects an invalid recurrence combination before touching the database", async () => {
    const mock = makeSupabaseMock({});
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "biweekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
      // missing recurrenceAnchorDate
    });
    expect(result).toEqual({ error: "recurrence_anchor_date is required for biweekly schedules" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects a type that doesn't require a host", async () => {
    const mock = makeSupabaseMock({ requiresHost: false });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
    });
    expect(result).toEqual({ error: "This prickle type doesn't take a host" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects a request for a locked month", async () => {
    const mock = makeSupabaseMock({ lockOverrides: [{ month: "2027-01-01", locked: true }] });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
    });
    expect(result).toEqual({
      error: "This month is locked -- ask an admin to unlock it, or request next month instead",
    });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("scopes the insert to the acting member's own host_id, always as 'proposed'", async () => {
    const mock = makeSupabaseMock({ lockOverrides: [{ month: "2027-01-01", locked: false }] });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
      // Even if a caller tried to smuggle these in via `as any`, the function
      // signature doesn't accept them -- there's nothing to strip.
    } as any);

    expect(result).toEqual({ success: true });
    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({ host_id: "member-1", status: "proposed" })
    );
  });

  it("scopes the insert to the sudo'd member, not the real admin, while sudo'd", async () => {
    const mock = makeSupabaseMock({ lockOverrides: [{ month: "2027-01-01", locked: false }] });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);

    await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
    });

    expect(mock.__insert).toHaveBeenCalledWith(expect.objectContaining({ host_id: "sudo-target-member" }));
  });
});

describe("updateMySchedule", () => {
  it("rejects when the row belongs to a different host", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "s1", host_id: "someone-else", month: "2027-01-01" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateMySchedule("s1", { notes: "hi" });
    expect(result).toEqual({ error: "Schedule not found" });
    expect(mock.__updateEqEq).not.toHaveBeenCalled();
  });

  it("rejects an edit to a locked month", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: true }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateMySchedule("s1", { notes: "hi" });
    expect(result).toEqual({ error: "This month is locked -- ask an admin to unlock it" });
    expect(mock.__updateEqEq).not.toHaveBeenCalled();
  });

  it("updates the acting member's own row in an unlocked month", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: false }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateMySchedule("s1", { notes: "new notes" });
    expect(result).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith(expect.objectContaining({ notes: "new notes" }));
  });

  it("never sends status or confirmed_* fields through, even if smuggled via `as any`", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: false }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await updateMySchedule("s1", { notes: "x", status: "confirmed", confirmed_by: "attacker" } as any);

    const updatePayload: any = mock.__update.mock.calls[0]?.[0];
    expect(updatePayload.status).toBeUndefined();
    expect(updatePayload.confirmed_by).toBeUndefined();
  });
});

describe("withdrawMySchedule", () => {
  it("rejects when there is no member record", async () => {
    const mock = makeSupabaseMock({});
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    const result = await withdrawMySchedule("s1");
    expect(result).toEqual({ error: "No member record" });
  });

  it("rejects withdrawing from a locked month", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: true }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await withdrawMySchedule("s1");
    expect(result).toEqual({ error: "This month is locked -- ask an admin to unlock it" });
  });

  it("soft-deletes (never hard-deletes) the acting member's own row", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: false }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await withdrawMySchedule("s1");
    expect(result).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String), deleted_by: "auth-user-1" })
    );
  });
});

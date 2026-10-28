import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Join dates and the hosted count come from the members and prickles repositories (in memory);
// makeSupabaseMock sets them up from its arguments.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getMySchedules, requestToHost, updateMySchedule, withdrawMySchedule } from "@/app/(member)/hosting/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

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
  existingRow = null as { id: string; host_id: string; month: string; status?: string } | null,
  // Join dates for the acting member (defaults to a long-standing member, who
  // is eligible to host). null = no members row found.
  memberJoin = { first_joined_at: "2020-01-01", most_recent_joined_at: "2020-01-01" } as {
    first_joined_at: string | null;
    most_recent_joined_at: string | null;
  } | null,
  hostedCount = 0,
  confirmedScheduleCount = 0,
}) {
  const people = [IDENTITY, SUDO_IDENTITY];
  const data = new InMemoryDataset({
      members: memberJoin
        ? people.map((p) => ({
            id: p.memberId,
            name: p.memberName,
            email: p.memberEmail,
            firstJoinedAt: memberJoin.first_joined_at,
            mostRecentJoinedAt: memberJoin.most_recent_joined_at,
          }))
        : [],
      prickleTypes: [{ id: "type-a", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
      // Prickles the acting member already hosts (an exemption from the one-month rule).
      prickles: Array.from({ length: hostedCount }, (_, i) => ({
        id: `prkl_${String(i).padStart(12, "A")}`,
        typeId: null,
        hostId: IDENTITY.memberId,
        title: null,
        startTime: "2026-01-01T15:00:00Z",
        endTime: "2026-01-01T16:00:00Z",
        source: "calendar",
        calendarEventId: null,
      })),
      // The schedule the action edits or withdraws, and the confirmed ones that exempt a new member.
      prickleSchedules: [
        ...(existingRow ? [schedule(existingRow)] : []),
        ...Array.from({ length: confirmedScheduleCount }, (_, i) => schedule({ id: `confirmed-${i}`, host_id: IDENTITY.memberId, month: "2026-08-01", status: "confirmed" })),
      ],
  });
  repos = createInMemoryRepos(data);

  const from = vi.fn((table: string) => {
    if (table === "prickle_schedule_locks") {
      return chain({ data: lockOverrides });
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from,
    /** The schedules stored right now. */
    __schedules: () => data.prickleSchedules,
  };
}

function schedule(over: { id: string; host_id: string; month: string; status?: string }) {
  return {
    type_id: "type-a",
    recurrence_type: "weekly",
    day_of_week: 2,
    week_of_month: null,
    recurrence_anchor_date: null,
    event_date: null,
    start_time_local: "19:00",
    timezone: "America/New_York",
    status: "proposed",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    carried_forward_from: null,
    confirmed_by: null,
    confirmed_at: null,
    updated_by: null,
    updated_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

/** The schedule repository failing on one method, like a database error. */
function failSchedules(method: "insert" | "update" | "liveById", message: string) {
  repos = {
    ...repos,
    prickleSchedules: Object.assign(Object.create(repos.prickleSchedules), {
      [method]: async () => {
        throw new Error(message);
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestToHost", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock({});
    mock.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await requestToHost({
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly",
      dayOfWeek: 2,
      startTimeLocal: "19:00",
    });
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__schedules()).toHaveLength(0);
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
    expect(mock.__schedules()).toHaveLength(0);
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
    expect(mock.__schedules()).toHaveLength(0);
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
    expect(mock.__schedules()).toHaveLength(0);
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
    expect(mock.__schedules()).toEqual([expect.objectContaining({ host_id: "member-1", status: "proposed", updated_by: "auth-user-1" })]);
    // Hosting lives on the My Prickles "Hosting" tab (there's no standalone /hosting page).
    expect(revalidatePath).toHaveBeenCalledWith("/my-prickles", "layout");
  });

  it("returns the database's message when the insert fails", async () => {
    const mock = makeSupabaseMock({ lockOverrides: [{ month: "2027-01-01", locked: false }] });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    failSchedules("insert", "insert failed");

    const result = await requestToHost({ month: "2027-01-01", typeId: "type-a", recurrenceType: "weekly", dayOfWeek: 2, startTimeLocal: "19:00" });

    expect(result).toEqual({ error: "insert failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
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

    expect(mock.__schedules()).toEqual([expect.objectContaining({ host_id: "sudo-target-member" })]);
  });

  describe("one-full-month rule", () => {
    const REQUEST = {
      month: "2027-01-01",
      typeId: "type-a",
      recurrenceType: "weekly" as const,
      dayOfWeek: 2,
      startTimeLocal: "19:00",
    };
    const UNLOCKED = [{ month: "2027-01-01", locked: false }];

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-26T16:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("blocks a member who first joined less than a month ago, with a friendly message and no insert", async () => {
      const mock = makeSupabaseMock({
        lockOverrides: UNLOCKED,
        memberJoin: { first_joined_at: "2026-09-10", most_recent_joined_at: "2026-09-10" },
      });
      vi.mocked(createClient).mockResolvedValue(mock as any);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

      const result = await requestToHost(REQUEST);
      expect(result).toEqual({
        error: "We invite hedgies to host once they've been a member for a full month — for you, that's October 10, 2026.",
      });
      expect(mock.__schedules()).toHaveLength(0);
    });

    it("blocks a member with no join date on record", async () => {
      const mock = makeSupabaseMock({
        lockOverrides: UNLOCKED,
        memberJoin: { first_joined_at: null, most_recent_joined_at: null },
      });
      vi.mocked(createClient).mockResolvedValue(mock as any);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

      const result = await requestToHost(REQUEST);
      expect(result).toEqual({ error: "We invite hedgies to host once they've been a member for a full month." });
      expect(mock.__schedules()).toHaveLength(0);
    });

    it("allows a member exactly one month after first joining", async () => {
      const mock = makeSupabaseMock({
        lockOverrides: UNLOCKED,
        memberJoin: { first_joined_at: "2026-08-26", most_recent_joined_at: "2026-08-26" },
      });
      vi.mocked(createClient).mockResolvedValue(mock as any);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

      expect(await requestToHost(REQUEST)).toEqual({ success: true });
      expect(mock.__schedules()).toHaveLength(1);
    });

    it("allows a rejoiner who rejoined days ago but first joined years ago", async () => {
      const mock = makeSupabaseMock({
        lockOverrides: UNLOCKED,
        memberJoin: { first_joined_at: "2021-03-01", most_recent_joined_at: "2026-09-20" },
      });
      vi.mocked(createClient).mockResolvedValue(mock as any);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

      expect(await requestToHost(REQUEST)).toEqual({ success: true });
      expect(mock.__schedules()).toHaveLength(1);
    });

    it("exempts a new member who has already hosted a prickle", async () => {
      const mock = makeSupabaseMock({
        lockOverrides: UNLOCKED,
        memberJoin: { first_joined_at: "2026-09-10", most_recent_joined_at: "2026-09-10" },
        hostedCount: 2,
      });
      vi.mocked(createClient).mockResolvedValue(mock as any);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

      expect(await requestToHost(REQUEST)).toEqual({ success: true });
    });

    it("exempts a new member an admin has already confirmed as a host", async () => {
      const mock = makeSupabaseMock({
        lockOverrides: UNLOCKED,
        memberJoin: { first_joined_at: "2026-09-10", most_recent_joined_at: "2026-09-10" },
        confirmedScheduleCount: 1,
      });
      vi.mocked(createClient).mockResolvedValue(mock as any);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

      expect(await requestToHost(REQUEST)).toEqual({ success: true });
    });
  });
});

describe("getMySchedules", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T16:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the acting member's schedules for this month and next, seeding next month from this month's confirmed slot", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "s1", host_id: "member-1", month: "2026-09-01", status: "confirmed" } });
    mock.__schedules().push(schedule({ id: "theirs", host_id: "sudo-target-member", month: "2026-09-01" }));
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const rows = await getMySchedules();

    expect(rows.map((r) => [r.month, r.status, r.typeName, r.carriedForwardFrom])).toEqual([
      ["2026-09-01", "confirmed", "Sprint", null],
      ["2026-10-01", "proposed", "Sprint", "s1"],
    ]);
    expect(rows[0]).toMatchObject({ typeId: "type-a", recurrenceType: "weekly", dayOfWeek: 2, startTimeLocal: "19:00", timezone: "America/New_York" });
  });

  it("does not seed a next month that is locked", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2026-09-01", status: "confirmed" },
      lockOverrides: [{ month: "2026-10-01", locked: true }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await getMySchedules()).toHaveLength(1);
    expect(mock.__schedules()).toHaveLength(1);
  });

  it("is empty with no signed-in member", async () => {
    const mock = makeSupabaseMock({});
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    expect(await getMySchedules()).toEqual([]);
  });
});

describe("updateMySchedule", () => {
  it("rejects when the row belongs to a different host", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "s1", host_id: "someone-else", month: "2027-01-01" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateMySchedule("s1", { notes: "hi" });
    expect(result).toEqual({ error: "Schedule not found" });
    expect(mock.__schedules()[0].notes).toBeNull();
  });

  it("says the schedule is not found when it was already withdrawn", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" } });
    mock.__schedules()[0].deleted_at = "2026-09-02T00:00:00Z";
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await updateMySchedule("s1", { notes: "hi" })).toEqual({ error: "Schedule not found" });
  });

  it("returns the database's message when the update fails", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: false }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    failSchedules("update", "update failed");

    expect(await updateMySchedule("s1", { notes: "hi" })).toEqual({ error: "update failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
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
    expect(mock.__schedules()[0].notes).toBeNull();
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
    expect(mock.__schedules()[0]).toMatchObject({ notes: "new notes", updated_by: "auth-user-1" });
    expect(revalidatePath).toHaveBeenCalledWith("/my-prickles", "layout");
  });

  it("never sends status or confirmed_* fields through, even if smuggled via `as any`", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: false }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await updateMySchedule("s1", { notes: "x", status: "confirmed", confirmed_by: "attacker" } as any);

    expect(mock.__schedules()[0]).toMatchObject({ notes: "x", status: "proposed", confirmed_by: null });
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
    expect(mock.__schedules()).toEqual([expect.objectContaining({ id: "s1", deleted_at: expect.any(String), deleted_by: "auth-user-1" })]);
    expect(revalidatePath).toHaveBeenCalledWith("/my-prickles", "layout");
  });

  it("returns the database's message when the withdrawal fails", async () => {
    const mock = makeSupabaseMock({
      existingRow: { id: "s1", host_id: "member-1", month: "2027-01-01" },
      lockOverrides: [{ month: "2027-01-01", locked: false }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    failSchedules("update", "withdraw failed");

    expect(await withdrawMySchedule("s1")).toEqual({ error: "withdraw failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a schedule that belongs to someone else or is gone", async () => {
    const mock = makeSupabaseMock({ existingRow: { id: "s1", host_id: "someone-else", month: "2027-01-01" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await withdrawMySchedule("s1")).toEqual({ error: "Schedule not found" });
    expect(await withdrawMySchedule("missing")).toEqual({ error: "Schedule not found" });
    expect(mock.__schedules()[0].deleted_at).toBeNull();
  });
});

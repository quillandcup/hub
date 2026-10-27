import { describe, it, expect, vi, beforeEach } from "vitest";

// getUnloggedRecentPrickles / dismissUnloggedPrickle scope every read and write to
// effectiveIdentity.memberId; RLS enforcement is covered by
// supabase/tests/database/prickle_checkout_dismissals.test.sql.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn().mockResolvedValue("UTC") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Attendance comes from its repository; the other tables are still faked below.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Prickle } from "@/lib/data/prickles";
import { dismissUnloggedPrickle, getUnloggedRecentPrickles } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { checkinToRow, EMPTY_CHECKIN } from "@/lib/prickle-checkins";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };

/** Chainable query fake: every filter returns itself; awaiting resolves the table's rows. */
function makeQueryFake(tables: Record<string, unknown[]>, upsertError: unknown = null) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
      upsert: (...args: unknown[]) => {
        calls.push({ table, method: "upsert", args });
        return Promise.resolve({ error: upsertError });
      },
    };
    for (const method of ["select", "eq", "gte", "not", "in", "is", "update"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    return builder;
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return calls;
}

const SPRINT = { id: "ptyp-sprint", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const social = { ...SPRINT, id: "ptyp-social", name: "Social Hour", normalizedName: "social-hour", purpose: "social" };

/** A prickle of `type` the member (member-1) attended, starting at `start`. */
function attended(id: string, start: string, type = SPRINT) {
  const prickle: Prickle = { id, typeId: type.id, hostId: null, title: null, startTime: start, endTime: start, source: "calendar", calendarEventId: null };
  return { prickle, attendance: { id: `att-${id}`, memberId: "member-1", prickleId: id, joinTime: start, leaveTime: start } };
}

function attendedDataset(rows: ReturnType<typeof attended>[]) {
  return createInMemoryRepos(
    new InMemoryDataset({
      prickleTypes: [SPRINT, social],
      prickles: rows.map((r) => r.prickle),
      attendance: rows.map((r) => r.attendance),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("getUnloggedRecentPrickles", () => {
  it("leaves out prickles the member logged, dismissed or checked out of", async () => {
    const recent = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    repos = attendedDataset([
      attended("p-open", recent(5)),
      attended("p-logged", recent(4)),
      attended("p-dismissed", recent(3)),
      attended("p-checked-out", recent(2)),
      attended("p-checked-in", recent(1)),
      attended("p-social", recent(1), social), // not a writing prickle: never asked about
      attended("p-long-ago", recent(24 * 60)), // older than the lookback
    ]);
    const calls = makeQueryFake({
      writing_progress_entries: [{ prickle_id: "p-logged" }],
      prickle_checkout_dismissals: [{ prickle_id: "p-dismissed" }],
      prickle_checkins: [
        { prickle_id: "p-checked-out", ...checkinToRow({ ...EMPTY_CHECKIN, intentionMet: 4, pleasantAfter: 4, energyAfter: 3 }) },
        // Only the check-in half answered: still owed a check-out.
        { prickle_id: "p-checked-in", ...checkinToRow({ ...EMPTY_CHECKIN, pleasantBefore: 3, energyBefore: 3, need: "company" }) },
      ],
    });

    const result = await getUnloggedRecentPrickles();

    expect(result.map((p) => p.id).sort()).toEqual(["p-checked-in", "p-open"]);
    expect(calls).toContainEqual({ table: "prickle_checkout_dismissals", method: "eq", args: ["member_id", "member-1"] });
  });
});

describe("dismissUnloggedPrickle", () => {
  it("records the dismissal for the acting member", async () => {
    const calls = makeQueryFake({});
    expect(await dismissUnloggedPrickle("p1")).toEqual({ success: true });
    expect(calls).toContainEqual({
      table: "prickle_checkout_dismissals",
      method: "upsert",
      args: [
        { member_id: "member-1", prickle_id: "p1" },
        { onConflict: "member_id,prickle_id", ignoreDuplicates: true },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("reports a database error", async () => {
    makeQueryFake({}, { message: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await dismissUnloggedPrickle("p1")).toEqual({ error: "Couldn't dismiss that prickle — please try again." });
  });

  it("rejects a missing prickle id", async () => {
    makeQueryFake({});
    expect(await dismissUnloggedPrickle("")).toEqual({ error: "Invalid prickle" });
  });
});

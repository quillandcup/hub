import { describe, it, expect, vi, beforeEach } from "vitest";

// getUnloggedRecentPrickles / dismissUnloggedPrickle scope every read and write to
// effectiveIdentity.memberId; RLS enforcement is covered by
// supabase/tests/database/writing_prompt_dismissals.test.sql.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn().mockResolvedValue("UTC") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { dismissUnloggedPrickle, getUnloggedRecentPrickles } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

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
    for (const method of ["select", "eq", "gte", "not", "in", "is"]) {
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

function attended(id: string, start: string) {
  return { prickle_id: id, prickles: { id, start_time: start, host: null, prickle_types: { name: "Sprint" } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("getUnloggedRecentPrickles", () => {
  it("leaves out prickles the member logged, dismissed or checked out of", async () => {
    const recent = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    const calls = makeQueryFake({
      prickle_attendance: [attended("p-open", recent(5)), attended("p-logged", recent(4)), attended("p-dismissed", recent(3)), attended("p-checked-out", recent(2)), attended("p-checked-in", recent(1))],
      writing_progress_entries: [{ prickle_id: "p-logged" }],
      writing_prompt_dismissals: [{ prickle_id: "p-dismissed" }],
      prickle_checkins: [
        { prickle_id: "p-checked-out", feelings_before: [], need: null, session_rating: 4, feelings_after: ["calm"] },
        // Only the check-in half answered: still owed a check-out.
        { prickle_id: "p-checked-in", feelings_before: ["calm"], need: "gentle", session_rating: null, feelings_after: [] },
      ],
    });

    const result = await getUnloggedRecentPrickles();

    expect(result.map((p) => p.id).sort()).toEqual(["p-checked-in", "p-open"]);
    expect(calls).toContainEqual({ table: "writing_prompt_dismissals", method: "eq", args: ["member_id", "member-1"] });
  });
});

describe("dismissUnloggedPrickle", () => {
  it("records the dismissal for the acting member", async () => {
    const calls = makeQueryFake({});
    expect(await dismissUnloggedPrickle("p1")).toEqual({ success: true });
    expect(calls).toContainEqual({
      table: "writing_prompt_dismissals",
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

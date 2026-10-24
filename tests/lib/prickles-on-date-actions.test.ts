import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";
import { createFakeSupabase } from "@/tests/helpers/server-page";

// getPricklesOnDate lists a day's prickles for the "During which prickle?" picker and marks the
// ones the acting member attended, using the attendance repository.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn().mockResolvedValue("UTC") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let attendance = new InMemoryAttendanceRepository();
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ attendance }) }));

import { getPricklesOnDate } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.test", isSudo: false };
const prickle = (id: string, start: string) => ({ id, start_time: start, host: { name: "Fern Example" }, prickle_types: { name: "Sprint Writing" } });
const row = (id: string, memberId: string, prickleId: string) => ({
  id,
  memberId,
  prickleId,
  joinTime: "2026-10-20T15:00:00Z",
  leaveTime: "2026-10-20T16:00:00Z",
});

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "ada@example.test" });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
  vi.mocked(createClient).mockResolvedValue(
    createFakeSupabase({
      prickles: {
        data: [
          prickle("prkl_AAAAAAAAAAA1", "2026-10-20T15:00:00Z"),
          prickle("prkl_AAAAAAAAAAA2", "2026-10-20T19:00:00Z"),
          prickle("prkl_AAAAAAAAAAA3", "2026-10-21T15:00:00Z"), // another day
        ],
      },
    }) as never,
  );
  attendance = new InMemoryAttendanceRepository([
    row("a1", IDENTITY.memberId, "prkl_AAAAAAAAAAA2"),
    row("a2", "mbr_AAAAAAAAAAA9", "prkl_AAAAAAAAAAA1"), // someone else's
  ]);
});

describe("getPricklesOnDate", () => {
  it("marks the prickles the acting member attended, not other members' attendance", async () => {
    const attendedAmong = vi.spyOn(attendance, "attendedAmong");

    const options = await getPricklesOnDate("2026-10-20");

    expect(attendedAmong).toHaveBeenCalledWith(IDENTITY.memberId, ["prkl_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA2"]);
    expect(options.map((o) => [o.id, o.attended])).toEqual(expect.arrayContaining([
      ["prkl_AAAAAAAAAAA2", true],
      ["prkl_AAAAAAAAAAA1", false],
    ]));
    expect(options).toHaveLength(2);
  });

  it("skips the attendance lookup when nothing happened that day", async () => {
    const attendedAmong = vi.spyOn(attendance, "attendedAmong");

    expect(await getPricklesOnDate("2026-10-25")).toEqual([]);
    expect(attendedAmong).not.toHaveBeenCalled();
  });
});

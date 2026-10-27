import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Prickle } from "@/lib/data/prickles";

// getPricklesOnDate lists a day's prickles for the "During which prickle?" picker and marks the
// ones the acting member attended, using the attendance repository.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn().mockResolvedValue("UTC") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getMyPrickleAttendance, getPricklesOnDate } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.test", isSudo: false };
const TYPE = { id: "ptyp_AAAAAAAAAAA1", name: "Sprint Writing", normalizedName: "sprint-writing", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, start: string): Prickle => ({
  id,
  typeId: TYPE.id,
  hostId: "mbr_AAAAAAAAAAA2",
  title: null,
  startTime: start,
  endTime: start,
  source: "calendar",
  calendarEventId: null,
});
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
  vi.mocked(createClient).mockResolvedValue({} as never);
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [{ id: "mbr_AAAAAAAAAAA2", name: "Fern Example" }],
      prickleTypes: [TYPE],
      prickles: [
        prickle("prkl_AAAAAAAAAAA1", "2026-10-20T15:00:00Z"),
        prickle("prkl_AAAAAAAAAAA2", "2026-10-20T19:00:00Z"),
        prickle("prkl_AAAAAAAAAAA3", "2026-10-21T15:00:00Z"), // another day
      ],
      attendance: [
        row("a1", IDENTITY.memberId, "prkl_AAAAAAAAAAA2"),
        row("a2", "mbr_AAAAAAAAAAA9", "prkl_AAAAAAAAAAA1"), // someone else's
      ],
    }),
  );
});

describe("getPricklesOnDate", () => {
  it("lists the day's prickles and marks the ones the acting member attended, not other members' attendance", async () => {
    const attendedAmong = vi.spyOn(repos.attendance, "attendedAmong");

    const options = await getPricklesOnDate("2026-10-20");

    expect(attendedAmong).toHaveBeenCalledWith(IDENTITY.memberId, ["prkl_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA2"]);
    expect(options.map((o) => [o.id, o.attended])).toEqual(
      expect.arrayContaining([
        ["prkl_AAAAAAAAAAA2", true],
        ["prkl_AAAAAAAAAAA1", false],
      ]),
    );
    expect(options).toHaveLength(2);
    // The attended prickle comes first; labels carry the type and the host's first name.
    expect(options[0].label).toBe("Tue, Oct 20 · 7:00 PM · Sprint Writing with Fern");
  });

  it("skips the attendance lookup when nothing happened that day", async () => {
    const attendedAmong = vi.spyOn(repos.attendance, "attendedAmong");

    expect(await getPricklesOnDate("2026-10-25")).toEqual([]);
    expect(attendedAmong).not.toHaveBeenCalled();
  });
});

describe("getMyPrickleAttendance", () => {
  it("reduces the member's writing-prickle attendance to local dates, leaving out other purposes and other members", async () => {
    const social = { ...TYPE, id: "ptyp_AAAAAAAAAAA2", name: "Social Hour", normalizedName: "social-hour", purpose: "social" };
    repos = createInMemoryRepos(
      new InMemoryDataset({
        prickleTypes: [TYPE, social],
        prickles: [
          prickle("prkl_AAAAAAAAAAA1", "2026-10-20T23:30:00Z"),
          { ...prickle("prkl_AAAAAAAAAAA2", "2026-10-21T15:00:00Z"), typeId: social.id },
          prickle("prkl_AAAAAAAAAAA3", "2026-10-22T15:00:00Z"),
        ],
        attendance: [
          row("a1", IDENTITY.memberId, "prkl_AAAAAAAAAAA1"),
          row("a2", IDENTITY.memberId, "prkl_AAAAAAAAAAA2"), // social: not counted
          row("a3", "mbr_AAAAAAAAAAA9", "prkl_AAAAAAAAAAA3"), // someone else's
        ],
      }),
    );

    expect(await getMyPrickleAttendance()).toEqual([{ prickleId: "prkl_AAAAAAAAAAA1", localDate: "2026-10-20" }]);
  });
});

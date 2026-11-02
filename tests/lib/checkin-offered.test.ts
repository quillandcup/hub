import { describe, it, expect, vi } from "vitest";
import { createInMemoryRepos } from "@/lib/data/repos";
import { CHECKIN_GRACE_MS, CHECKIN_SOON_MS, checkinOffered, getCheckinPrickles, type HighlightReason } from "@/lib/upcoming-prickles";

const NOW = new Date("2026-10-05T14:00:00.000Z");
const TIED: HighlightReason[] = [{ kind: "commitment", tooltip: ["Week 1 of 4"] }];
const startingIn = (ms: number) => ({ startTime: new Date(NOW.getTime() + ms).toISOString() });

describe("checkinOffered", () => {
  it("is offered from CHECKIN_SOON_MS before the start until CHECKIN_GRACE_MS (18 minutes) after it", () => {
    expect(checkinOffered(startingIn(CHECKIN_SOON_MS), TIED, NOW)).toBe(true);
    expect(checkinOffered(startingIn(0), TIED, NOW)).toBe(true);
    expect(checkinOffered(startingIn(-CHECKIN_GRACE_MS), TIED, NOW)).toBe(true);
    expect(CHECKIN_GRACE_MS).toBe(18 * 60 * 1000);
  });

  it("is not offered earlier, or once the 18 minutes are over", () => {
    expect(checkinOffered(startingIn(CHECKIN_SOON_MS + 1), TIED, NOW)).toBe(false);
    expect(checkinOffered(startingIn(-CHECKIN_GRACE_MS - 1), TIED, NOW)).toBe(false);
  });

  it("still needs a personal tie", () => {
    expect(checkinOffered(startingIn(-60_000), [{ kind: "streak", tooltip: [] }], NOW)).toBe(false);
  });
});

describe("getCheckinPrickles", () => {
  it("looks back CHECKIN_GRACE_MS so a prickle in progress is found", async () => {
    const repos = createInMemoryRepos();
    const spy = vi.spyOn(repos.prickles, "startingBetween");

    await getCheckinPrickles(repos, "mbr_AAAAAAAAAAA1", "UTC", NOW);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ from: new Date(NOW.getTime() - CHECKIN_GRACE_MS).toISOString() }));
  });
});

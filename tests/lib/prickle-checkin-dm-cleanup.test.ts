import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { EMPTY_CHECKIN } from "@/lib/prickle-checkins";

vi.mock("@/lib/slack-member-ids", () => ({
  resolveSlackUserIds: async (_repos: unknown, ids: string[]) => new Map(ids.map((id) => [id, `U-${id}`])),
}));

import { closeAnsweredCheckinDms } from "@/lib/prickle-checkin-dm-cleanup";

const TYPE = { id: "t1", name: "Progress Prickle", normalizedName: "progress", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const prickle = (id: string) => ({ id, typeId: TYPE.id, hostId: "host", title: null, startTime: hourAgo, endTime: hourAgo, source: "calendar", calendarEventId: null });
const log = (id: string, memberId: string, prickleId: string, kind: string) => ({ id, member_id: memberId, prickle_id: prickleId, kind, sent_at: hourAgo });
const dm = (ts: string, half: string, prickleId: string) => ({ ts, blocks: [{ block_id: `prickle_dismiss:${half}:${prickleId}` }] });

const DONE_IN = { ...EMPTY_CHECKIN, pleasantBefore: 4, energyBefore: 3, need: "company" } as typeof EMPTY_CHECKIN;
const PARTLY = { ...EMPTY_CHECKIN, pleasantBefore: 4 } as typeof EMPTY_CHECKIN;

function world(messages: object[]) {
  const data = new InMemoryDataset({
    members: [{ id: "host", name: "Host Example" }, { id: "m1", name: "Ada Example" }, { id: "m2", name: "Bea Example" }],
    prickleTypes: [TYPE],
    prickles: [prickle("p1"), prickle("p2")],
    checkinDmLog: [log("l1", "m1", "p1", "prickle_checkin"), log("l2", "m1", "p2", "prickle_checkin"), log("l3", "m2", "p1", "prickle_checkin")],
  });
  data.prickleCheckins.push({ memberId: "m1", prickleId: "p1", checkin: DONE_IN }, { memberId: "m1", prickleId: "p2", checkin: PARTLY }, { memberId: "m2", prickleId: "p1", checkin: PARTLY });
  const update = vi.fn(async () => ({}));
  const slack = {
    conversations: { open: vi.fn(async () => ({ channel: { id: "D1" } })), history: vi.fn(async () => ({ messages })) },
    chat: { update },
  };
  return { repos: createInMemoryRepos(data), slack: slack as never, update };
}

const SINCE = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("closeAnsweredCheckinDms", () => {
  it("collapses only the open DMs of a check-in that is done", async () => {
    const { repos, slack, update } = world([dm("1.1", "checkin", "p1"), dm("2.2", "checkin", "p2"), dm("3.3", "checkout", "p1"), { ts: "4.4", blocks: [] }]);

    const result = await closeAnsweredCheckinDms(repos, slack, { since: SINCE });

    expect(result).toEqual({ finished: 1, open: 1, closed: 1, failed: 0, notOpen: { noSlackAccount: 0, skippedOrSubmitted: 0, notInHistory: 0 } });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1", ts: "1.1", text: "✅ Checked in. Thanks!" }));
  });

  it("only counts on a dry run", async () => {
    const { repos, slack, update } = world([dm("1.1", "checkin", "p1")]);

    const result = await closeAnsweredCheckinDms(repos, slack, { since: SINCE, dryRun: true });

    expect(result).toMatchObject({ open: 1, closed: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it("counts a failed update and keeps going", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { repos, slack, update } = world([dm("1.1", "checkin", "p1")]);
    update.mockRejectedValueOnce(new Error("message_not_found"));

    const result = await closeAnsweredCheckinDms(repos, slack, { since: SINCE });

    expect(result).toMatchObject({ open: 1, closed: 0, failed: 1 });
  });

  it("says where a finished check-in with no open DM went", async () => {
    const { repos, slack } = world([dm("2.2", "checkin", "p2")]);
    await repos.prickleActivity.dismiss("checkin", "m1", "p1");

    const result = await closeAnsweredCheckinDms(repos, slack, { since: SINCE, dryRun: true });

    expect(result).toMatchObject({ finished: 1, open: 0, notOpen: { skippedOrSubmitted: 1, noSlackAccount: 0, notInHistory: 0 } });
  });

  it("counts a finished check-in missing from the DM history", async () => {
    const { repos, slack } = world([]);
    expect(await closeAnsweredCheckinDms(repos, slack, { since: SINCE, dryRun: true })).toMatchObject({ notOpen: { notInHistory: 1 } });
  });

  it("does nothing when no prickle started in the window", async () => {
    const { repos, slack } = world([]);

    expect(await closeAnsweredCheckinDms(repos, slack, { since: new Date() })).toEqual({ finished: 0, open: 0, closed: 0, failed: 0, notOpen: { noSlackAccount: 0, skippedOrSubmitted: 0, notInHistory: 0 } });
  });
});

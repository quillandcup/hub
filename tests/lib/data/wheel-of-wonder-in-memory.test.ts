import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryWheelOfWonderRepository } from "@/lib/data/wheel-of-wonder";
import { defineWheelOfWonderContract } from "@/tests/helpers/wheel-of-wonder-contract";

const members: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];

defineWheelOfWonderContract("InMemoryWheelOfWonderRepository", () => {
  const data = new InMemoryDataset({
    members: [
      { id: members[0], name: "Ada Example" },
      { id: members[1], name: "Fern Example" },
    ],
  });
  let n = 0;
  return {
    repo: () => new InMemoryWheelOfWonderRepository(data),
    members,
    unique: (label) => `C-${label}-${++n}`,
    clear: async () => {
      data.wheelMatches = [];
    },
  };
});

describe("InMemoryWheelOfWonderRepository specifics", () => {
  it("refuses a channel with two proposed matches, like the database's single-row read", async () => {
    const data = new InMemoryDataset();
    const repo = new InMemoryWheelOfWonderRepository(data);
    for (let i = 0; i < 2; i++) {
      await repo.recordProposed({ spinnerMemberId: members[0], matchedMemberId: members[1], slackChannelId: "C1", spinnerSlackUserId: null, matchedSlackUserId: null });
    }
    await expect(repo.proposedInChannel("C1")).rejects.toThrow();
  });

  it("ignores an exchange for a match that is gone, and leaves a member that is gone unnamed", async () => {
    const data = new InMemoryDataset();
    const repo = new InMemoryWheelOfWonderRepository(data);
    await repo.recordExchange("missing", { spinnerMessageCount: 1, matchedMessageCount: 1 });
    await repo.recordProposed({ spinnerMemberId: members[0], matchedMemberId: members[1], slackChannelId: "C1", spinnerSlackUserId: null, matchedSlackUserId: null });
    expect(await repo.recent(10)).toMatchObject([{ spinner: null, matched: null }]);
  });
});

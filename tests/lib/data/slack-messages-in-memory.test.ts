import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySlackMessageRepository } from "@/lib/data/slack-messages";
import { defineSlackMessageContract } from "@/tests/helpers/slack-messages-contract";

defineSlackMessageContract("InMemorySlackMessageRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemorySlackMessageRepository(data),
    unique: (label) => `M${label}${++n}`,
    seed: async ({ messages = [], reactions = [] }) => {
      data.slackMessages = messages.map((m) => ({ ...m }));
      data.slackReactions = reactions.map((r) => ({ ...r }));
    },
  };
});

describe("InMemorySlackMessageRepository on an empty workspace", () => {
  it("has no last import", async () => {
    expect(await new InMemorySlackMessageRepository(new InMemoryDataset()).lastImportedAt()).toBeNull();
  });
});

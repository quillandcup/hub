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
    stored: async (channelId, messageTs) => {
      const m = data.slackMessages.find((x) => x.channel_id === channelId && x.message_ts === messageTs);
      return m ? { text: m.text ?? null, edited_at: m.edited_at ?? null, reply_count: m.reply_count ?? null, files: m.files ?? null } : null;
    },
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

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySlackWorkspaceRepository } from "@/lib/data/slack-workspace";
import { defineSlackWorkspaceContract } from "@/tests/helpers/slack-workspace-contract";

defineSlackWorkspaceContract("InMemorySlackWorkspaceRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemorySlackWorkspaceRepository(data),
    unique: (label) => `C${label}${++n}`,
    seed: async ({ channels = [], ignoredUserIds = [] }) => {
      data.slackChannels = channels.map((c) => ({ ...c }));
      data.ignoredSlackUsers = ignoredUserIds.map((user_id) => ({ user_id }));
    },
  };
});

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySlackUserRepository } from "@/lib/data/slack-users";
import { defineSlackUserContract } from "@/tests/helpers/slack-user-contract";

defineSlackUserContract("InMemorySlackUserRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemorySlackUserRepository(data),
    unique: (label) => `U${label}${++n}`,
    seed: async (users) => {
      data.slackUsers = users.map((u) => ({ ...u }));
    },
  };
});

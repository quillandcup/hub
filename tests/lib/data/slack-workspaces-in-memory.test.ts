import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySlackMessageRepository } from "@/lib/data/slack-messages";
import { InMemorySlackUserRepository } from "@/lib/data/slack-users";
import { InMemorySlackWorkspaceRepository } from "@/lib/data/slack-workspace";
import { InMemorySlackWorkspaceRegistry } from "@/lib/data/slack-workspaces";
import { defineSlackWorkspacesContract } from "@/tests/helpers/slack-workspaces-contract";

defineSlackWorkspacesContract("InMemory", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    registry: () => new InMemorySlackWorkspaceRegistry(data),
    repos: (workspaceId) => ({
      messages: new InMemorySlackMessageRepository(data, workspaceId),
      workspace: new InMemorySlackWorkspaceRepository(data, workspaceId),
      users: new InMemorySlackUserRepository(data, workspaceId),
    }),
    unique: (label) => `${label}${++n}`,
    idsMayCollide: true,
  };
});

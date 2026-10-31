import { InMemoryAnalyticsEventRepository } from "@/lib/data/analytics-events";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySlackSignInRepository } from "@/lib/data/slack-sign-in";
import { defineAnalyticsEventContract } from "@/tests/helpers/analytics-event-contract";
import { defineSlackSignInContract } from "@/tests/helpers/slack-sign-in-contract";

let n = 0;

defineSlackSignInContract("InMemorySlackSignInRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemorySlackSignInRepository(data),
    unique: (label) => `${label}-${++n}`,
    newUserId: async () => crypto.randomUUID(),
  };
});

defineAnalyticsEventContract("InMemoryAnalyticsEventRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryAnalyticsEventRepository(data),
    newUserId: async () => crypto.randomUUID(),
    stored: async (userId) => data.analyticsEvents.filter((e) => e.user_id === userId),
  };
});

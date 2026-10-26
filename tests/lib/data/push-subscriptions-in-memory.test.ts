import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryPushSubscriptionRepository } from "@/lib/data/push-subscriptions";
import { definePushSubscriptionContract } from "@/tests/helpers/push-subscription-contract";

definePushSubscriptionContract("InMemoryPushSubscriptionRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryPushSubscriptionRepository(data),
    memberIds: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
    unique: (label) => `${label}-${++n}`,
    reset: async () => {
      data.pushSubscriptions = [];
    },
  };
});

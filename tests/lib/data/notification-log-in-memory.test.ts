import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryNotificationLogRepository } from "@/lib/data/notification-log";
import { defineNotificationLogContract } from "@/tests/helpers/notification-log-contract";

let n = 0;
defineNotificationLogContract("InMemoryNotificationLogRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryNotificationLogRepository(data),
    memberIds: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
    place: () => `slack:C${++n}`,
    reset: async () => {
      data.notificationLog = [];
    },
  };
});

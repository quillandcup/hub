import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryReminderLogRepository } from "@/lib/data/reminder-log";
import { defineReminderLogContract } from "@/tests/helpers/reminder-log-contract";

defineReminderLogContract("InMemoryReminderLogRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryReminderLogRepository(data),
    memberIds: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
    reset: async () => {
      data.reminderLog = [];
    },
  };
});

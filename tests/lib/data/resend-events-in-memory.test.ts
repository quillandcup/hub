import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryResendEventRepository } from "@/lib/data/resend";
import { defineResendEventContract } from "@/tests/helpers/resend-event-contract";

defineResendEventContract("InMemoryResendEventRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryResendEventRepository(data),
    unique: (label) => `${label}-${++n}`,
    clear: async () => {
      data.resendEvents = [];
    },
  };
});

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryProspectRepository } from "@/lib/data/prospects";
import { defineProspectContract } from "@/tests/helpers/prospect-contract";

defineProspectContract("InMemoryProspectRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryProspectRepository(data),
    handles: ["contract.one", "contract.two", "contract.three"],
    reset: async () => {
      data.prospects = [];
    },
  };
});

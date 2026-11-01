import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryRateLimitRepository } from "@/lib/data/rate-limit";
import { defineRateLimitContract } from "@/tests/helpers/rate-limit-contract";

let n = 0;

defineRateLimitContract("InMemoryRateLimitRepository", () => {
  const data = new InMemoryDataset();
  return { repo: () => new InMemoryRateLimitRepository(data), unique: (label) => `${label}-${++n}` };
});

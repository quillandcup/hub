import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryLandingSiteTemplateRepository } from "@/lib/data/landing-site-template";
import { defineLandingSiteTemplateContract } from "@/tests/helpers/landing-site-template-contract";

defineLandingSiteTemplateContract("InMemoryLandingSiteTemplateRepository", () => {
  const data = new InMemoryDataset();
  return { repo: () => new InMemoryLandingSiteTemplateRepository(data), reset: async () => {} };
});

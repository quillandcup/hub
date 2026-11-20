import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryLandingTemplateRepository } from "@/lib/data/landing-templates";
import { defineLandingTemplateContract } from "@/tests/helpers/landing-template-contract";

let n = 0;

defineLandingTemplateContract("InMemoryLandingTemplateRepository", () => {
  const data = new InMemoryDataset();
  return { repo: () => new InMemoryLandingTemplateRepository(data), unique: (label) => `${label}-${++n}` };
});

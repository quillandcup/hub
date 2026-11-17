import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryLandingPageRepository } from "@/lib/data/landing-pages";
import { defineLandingPageContract } from "@/tests/helpers/landing-page-contract";

let n = 0;

defineLandingPageContract("InMemoryLandingPageRepository", () => {
  const data = new InMemoryDataset();
  return { repo: () => new InMemoryLandingPageRepository(data), unique: (label) => `${label}-${++n}` };
});

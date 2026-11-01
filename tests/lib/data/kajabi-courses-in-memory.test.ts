import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryKajabiCourseRepository } from "@/lib/data/kajabi-courses";
import { defineKajabiCoursesContract } from "@/tests/helpers/kajabi-courses-contract";

defineKajabiCoursesContract("InMemoryKajabiCourseRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryKajabiCourseRepository(data),
    unique: (label) => `kc-${label}-${++n}`,
    clear: async () => {
      Object.assign(data, new InMemoryDataset());
    },
  };
});

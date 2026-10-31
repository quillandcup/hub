import { InMemoryCourseProgressRepository } from "@/lib/data/course-progress";
import { InMemoryCourseRepository } from "@/lib/data/courses";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineCourseContract } from "@/tests/helpers/course-contract";

defineCourseContract("InMemory course repositories", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    courses: () => new InMemoryCourseRepository(data),
    progress: () => new InMemoryCourseProgressRepository(data),
    unique: (label) => `${label}-${++n}`,
    members: async () => ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
    seed: {
      courses: async (rows) => void data.courses.push(...rows),
      modules: async (rows) => void data.courseModules.push(...rows),
      lessons: async (rows) => void data.courseLessons.push(...rows),
      files: async (rows) => void data.courseLessonFiles.push(...rows),
      videos: async (rows) => void data.videos.push(...rows),
      progress: async (rows) => void data.lessonProgress.push(...rows),
      access: async (rows) => void data.courseAccess.push(...rows),
    },
  };
});

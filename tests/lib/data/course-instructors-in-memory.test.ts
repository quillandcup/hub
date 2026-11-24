import { InMemoryCourseInstructorRepository } from "@/lib/data/course-instructors";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineCourseInstructorContract } from "@/tests/helpers/course-instructor-contract";

const COURSES: [string, string] = ["crs_AAAAAAAAAAA1", "crs_AAAAAAAAAAA2"];
const MEMBERS: [string, string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA3"];

const data = new InMemoryDataset({
  members: MEMBERS.map((id, i) => ({ id, name: `Member ${i + 1} Example` })),
  courses: COURSES.map((id, i) => ({ id, slug: `course-${i + 1}`, title: `Course ${i + 1}` }) as never),
});

defineCourseInstructorContract("InMemoryCourseInstructorRepository", () => ({
  repo: () => new InMemoryCourseInstructorRepository(data),
  courses: COURSES,
  members: MEMBERS,
  clear: async () => {
    data.courseInstructors = [];
  },
}));

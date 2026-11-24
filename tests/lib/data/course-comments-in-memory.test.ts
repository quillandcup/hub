import { InMemoryCourseCommentRepository } from "@/lib/data/course-comments";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineCourseCommentContract } from "@/tests/helpers/course-comment-contract";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSONS: [string, string] = ["les_AAAAAAAAAAA1", "les_AAAAAAAAAAA2"];
const MEMBERS = { ada: "mbr_AAAAAAAAAAA1", bea: "mbr_AAAAAAAAAAA2", staff: "mbr_AAAAAAAAAAA3" };

const data = new InMemoryDataset({
  members: [
    { id: MEMBERS.ada, name: "Ada Example" },
    { id: MEMBERS.bea, name: "Bea Example" },
    { id: MEMBERS.staff, name: "Sam Staff" },
  ],
  courses: [{ id: COURSE, slug: "story-basics", title: "Story Basics" } as never],
  courseLessons: LESSONS.map((id, i) => ({ id, course_id: COURSE, title: `Lesson ${i + 1}` }) as never),
});

defineCourseCommentContract("InMemoryCourseCommentRepository", () => ({
  repo: () => new InMemoryCourseCommentRepository(data),
  lessons: LESSONS,
  courseId: COURSE,
  course: { slug: "story-basics", title: "Story Basics" },
  lessonTitles: ["Lesson 1", "Lesson 2"],
  members: MEMBERS,
  setDisplayName: async (memberId, displayName) => {
    const member = data.members.find((m) => m.id === memberId);
    if (member) member.displayName = displayName;
  },
  bulk: async (lessonId, memberId, count, held) => {
    const repo = new InMemoryCourseCommentRepository(data);
    for (let i = 0; i < count; i++) await repo.create({ lessonId, memberId, parentId: null, body: `Comment ${i}`, isInstructorReply: false, held });
  },
  bulkReported: async (lessonId, authorId, reporterId, count) => {
    const repo = new InMemoryCourseCommentRepository(data);
    for (let i = 0; i < count; i++) {
      const made = await repo.create({ lessonId, memberId: authorId, parentId: null, body: `Reported ${i}`, isInstructorReply: false });
      await repo.report({ commentId: made.id, reporterId, reason: "Reported" });
    }
  },
  clear: async () => {
    data.lessonComments.length = 0;
    data.lessonCommentReports.length = 0;
    data.lessonCommentFollows.length = 0;
    data.lessonCommentReads.length = 0;
  },
}));

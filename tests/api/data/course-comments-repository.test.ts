import { afterAll, beforeAll } from "vitest";
import { chunk } from "@/lib/supabase/paginate";
import { SupabaseCourseCommentRepository } from "@/lib/data/course-comments";
import type { Db } from "@/lib/data/db";
import { defineCourseCommentContract } from "@/tests/helpers/course-comment-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `cmntrepo${Date.now()}`;
let courseId: string;
let lessons: [string, string];
let members: { ada: string; bea: string; staff: string };

const clear = async () => {
  if (!lessons) return;
  // Replies go with their question (ON DELETE CASCADE).
  const { error } = await db.from("lesson_comments").delete().in("lesson_id", lessons);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const course = await db.from("courses").insert({ slug: RUN, title: `Comments ${RUN}`, source_key: RUN }).select("id").single();
  if (course.error) throw new Error(course.error.message);
  courseId = course.data.id;
  const made = await db
    .from("course_lessons")
    .insert([0, 1].map((i) => ({ course_id: courseId, title: `Lesson ${i + 1}`, position: i + 1, source_key: `${RUN}-${i}` })))
    .select("id, position")
    .order("position");
  if (made.error) throw new Error(made.error.message);
  lessons = [made.data[0].id, made.data[1].id];
  const people = await db
    .from("members")
    .insert(["ada", "bea", "staff"].map((n) => ({ name: `Comment ${n} ${RUN}`, email: `${RUN}-${n}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email")
    .order("email");
  if (people.error) throw new Error(people.error.message);
  const byName = (n: string) => people.data.find((p) => p.email === `${RUN}-${n}@example.com`)!.id;
  members = { ada: byName("ada"), bea: byName("bea"), staff: byName("staff") };
});

afterAll(async () => {
  await clear();
  await db.from("courses").delete().eq("id", courseId ?? "");
  await db.from("members").delete().in("id", members ? Object.values(members) : []);
});

defineCourseCommentContract("SupabaseCourseCommentRepository", () => ({
  repo: () => new SupabaseCourseCommentRepository(db),
  get lessons() {
    return lessons;
  },
  get courseId() {
    return courseId;
  },
  lessonTitles: ["Lesson 1", "Lesson 2"],
  get members() {
    return members;
  },
  setDisplayName: async (memberId, displayName) => {
    const { error } = await db.from("members").update({ display_name: displayName }).eq("id", memberId);
    if (error) throw new Error(error.message);
  },
  bulk: async (lessonId, memberId, count) => {
    const rows = Array.from({ length: count }, (_, i) => ({ lesson_id: lessonId, member_id: memberId, body: `Comment ${i}` }));
    for (const part of chunk(rows, 500)) {
      const { error } = await db.from("lesson_comments").insert(part);
      if (error) throw new Error(error.message);
    }
  },
  clear,
}));

import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCourseInstructorRepository } from "@/lib/data/course-instructors";
import { defineCourseInstructorContract } from "@/tests/helpers/course-instructor-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let courses: [string, string];
let members: [string, string, string];

const clear = async () => {
  if (!courses) return;
  const { error } = await db.from("course_instructors").delete().in("course_id", courses);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const made = await db
    .from("courses")
    .insert([0, 1].map((i) => ({ slug: `instr-${RUN}-${i}`, title: `Instructors ${RUN} ${i}`, source_key: `instr-${RUN}-${i}` })))
    .select("id, slug")
    .order("slug");
  if (made.error) throw new Error(made.error.message);
  courses = [made.data[0].id, made.data[1].id];
  const people = await db
    .from("members")
    .insert(["ada", "bea", "cara"].map((n) => ({ name: `Instructor ${n} ${RUN}`, email: `${RUN}-instr-${n}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (people.error) throw new Error(people.error.message);
  const byName = (n: string) => people.data.find((p) => p.email === `${RUN}-instr-${n}@example.com`)!.id;
  members = [byName("ada"), byName("bea"), byName("cara")];
});

afterAll(async () => {
  await clear();
  await db.from("courses").delete().in("id", courses ?? []);
  await db.from("members").delete().in("id", members ?? []);
});

defineCourseInstructorContract("SupabaseCourseInstructorRepository", () => ({
  repo: () => new SupabaseCourseInstructorRepository(db),
  get courses() {
    return courses;
  },
  get members() {
    return members;
  },
  clear,
}));

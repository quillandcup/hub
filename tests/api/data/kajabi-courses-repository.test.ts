import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseKajabiCourseRepository } from "@/lib/data/kajabi-courses";
import { defineKajabiCoursesContract } from "@/tests/helpers/kajabi-courses-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const PREFIX = `kc-${Date.now()}-`;
let counter = 0;

// Every id the contract makes starts with this run's prefix: courses by id, everything else by its course or lesson.
const clear = async () => {
  const bronze = db.schema("bronze");
  const like = `${PREFIX}%`;
  const results = await Promise.all([
    bronze.from("kajabi_courses").delete().like("kajabi_id", like),
    bronze.from("kajabi_course_modules").delete().like("course_kajabi_id", like),
    bronze.from("kajabi_course_lessons").delete().like("course_kajabi_id", like),
    bronze.from("kajabi_lesson_files").delete().like("lesson_kajabi_id", like),
    bronze.from("kajabi_course_offers").delete().like("course_kajabi_id", like),
    bronze.from("kajabi_product_progress").delete().like("course_kajabi_id", like),
    bronze.from("kajabi_lesson_progress").delete().like("course_kajabi_id", like),
  ]);
  for (const { error } of results) if (error) throw new Error(error.message);
};

afterAll(clear);

defineKajabiCoursesContract("SupabaseKajabiCourseRepository", () => ({
  repo: () => new SupabaseKajabiCourseRepository(db),
  unique: (label) => `${PREFIX}${label}-${++counter}`,
  clear,
}));

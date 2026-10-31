import { afterAll } from "vitest";
import { chunk } from "@/lib/supabase/paginate";
import { SupabaseCourseProgressRepository } from "@/lib/data/course-progress";
import { SupabaseCourseRepository } from "@/lib/data/courses";
import type { Db } from "@/lib/data/db";
import { defineCourseContract } from "@/tests/helpers/course-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `crsrepo${Date.now()}`;
let counter = 0;
const courseIds: string[] = [];
const videoIds: string[] = [];
const memberIds: string[] = [];

// Deleting a course takes its modules, lessons, downloads, progress and access with it.
afterAll(async () => {
  if (courseIds.length) await db.from("courses").delete().in("id", courseIds);
  if (videoIds.length) await db.from("videos").delete().in("id", videoIds);
  if (memberIds.length) await db.from("members").delete().in("id", memberIds);
});

async function insert(table: "courses" | "course_modules" | "course_lessons" | "course_lesson_files" | "videos" | "lesson_progress" | "course_access", rows: object[]) {
  for (const part of chunk(rows, 500)) {
    const { error } = await db.from(table).insert(part as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

defineCourseContract("Supabase course repositories", () => {
  let pair: [string, string] | undefined;
  return {
    courses: () => new SupabaseCourseRepository(db),
    progress: () => new SupabaseCourseProgressRepository(db),
    unique: (label) => `${RUN}-${label.replace(/[^A-Za-z0-9]/g, "")}-${++counter}`.toLowerCase(),
    members: async () => {
      if (!pair) {
        const tag = `${RUN}-${++counter}`;
        const { data, error } = await db
          .from("members")
          .insert([1, 2].map((i) => ({ name: `Course Student ${i} ${tag}`, email: `${tag}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
          .select("id, email")
          .order("email");
        if (error) throw new Error(error.message);
        memberIds.push(...data!.map((m) => m.id));
        pair = [data![0].id, data![1].id];
      }
      return pair;
    },
    seed: {
      courses: async (rows) => {
        courseIds.push(...rows.map((r) => r.id));
        await insert("courses", rows);
      },
      modules: (rows) => insert("course_modules", rows),
      lessons: (rows) => insert("course_lessons", rows),
      files: (rows) => insert("course_lesson_files", rows),
      videos: async (rows) => {
        videoIds.push(...rows.map((r) => r.id));
        await insert("videos", rows);
      },
      progress: (rows) => insert("lesson_progress", rows),
      access: (rows) => insert("course_access", rows),
    },
  };
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunk } from "@/lib/supabase/paginate";
import type { Db } from "@/lib/data/db";
import { SupabaseQuizRepository } from "@/lib/data/quizzes";
import { defineQuizContract } from "@/tests/helpers/quiz-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `quizrepo${Date.now()}`;
let courseId: string;
let kajabiCourseId: string;
let lessons: [string, string];
let kajabiLessons: [string, string];
let members: [string, string];

const clear = async () => {
  if (!lessons) return;
  // Questions, options, attempts and answers go with their quiz (ON DELETE CASCADE).
  const { error } = await db.from("quizzes").delete().in("lesson_id", [...lessons, ...(kajabiLessons ?? [])]);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const course = await db.from("courses").insert({ slug: RUN, title: `Quizzes ${RUN}`, source: "hub" }).select("id").single();
  if (course.error) throw new Error(course.error.message);
  courseId = course.data.id;
  const made = await db
    .from("course_lessons")
    .insert([0, 1].map((i) => ({ course_id: courseId, title: `Lesson ${i + 1}`, position: i + 1, source: "hub" })))
    .select("id, position")
    .order("position");
  if (made.error) throw new Error(made.error.message);
  lessons = [made.data[0].id, made.data[1].id];
  const kajabi = await db.from("courses").insert({ slug: `${RUN}-k`, title: `Imported ${RUN}`, source: "kajabi", source_key: `${RUN}-k` }).select("id").single();
  if (kajabi.error) throw new Error(kajabi.error.message);
  kajabiCourseId = kajabi.data.id;
  const imported = await db
    .from("course_lessons")
    .insert([0, 1].map((i) => ({ course_id: kajabiCourseId, title: `Imported ${i + 1}`, position: i + 1, source: "kajabi", source_key: `${RUN}-k${i}` })))
    .select("id, position")
    .order("position");
  if (imported.error) throw new Error(imported.error.message);
  kajabiLessons = [imported.data[0].id, imported.data[1].id];
  const people = await db
    .from("members")
    .insert(["ada", "grace"].map((n) => ({ name: `Quiz ${n} ${RUN}`, email: `${RUN}-${n}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (people.error) throw new Error(people.error.message);
  const byName = (n: string) => people.data.find((p) => p.email === `${RUN}-${n}@example.com`)!.id;
  members = [byName("ada"), byName("grace")];
});

afterAll(async () => {
  await clear();
  await db.from("courses").delete().eq("id", courseId ?? "");
  await db.from("courses").delete().eq("id", kajabiCourseId ?? "");
  await db.from("members").delete().in("id", members ?? []);
});

defineQuizContract("SupabaseQuizRepository", () => ({
  repo: () => new SupabaseQuizRepository(db),
  get lessons() {
    return lessons;
  },
  get kajabiLessons() {
    return kajabiLessons;
  },
  get members() {
    return members;
  },
  clear,
}));

describe("SupabaseQuizRepository (database only)", () => {
  it("lists every attempt of a quiz past the 1000-row limit", async () => {
    await clear();
    const repo = new SupabaseQuizRepository(db);
    const quiz = await repo.createQuiz(lessons[0]);
    const rows = Array.from({ length: 1050 }, (_, i) => ({
      quiz_id: quiz.id,
      member_id: members[i % 2],
      question_count: 1,
      correct_count: 0,
      score_percent: 0,
      passed: false,
      submitted_at: new Date(Date.UTC(2027, 0, 1) + i * 1000).toISOString(),
    }));
    for (const part of chunk(rows, 500)) {
      const { error } = await db.from("quiz_attempts").insert(part);
      if (error) throw new Error(error.message);
    }

    const all = await repo.attemptsOfQuiz(quiz.id);

    expect(all).toHaveLength(1050);
    expect(new Set(all.map((a) => a.id)).size).toBe(1050);
    expect(all[0].submittedAt > all[1049].submittedAt).toBe(true);
    await clear();
  });

  it("leaves no options behind when a question is deleted", async () => {
    await clear();
    const repo = new SupabaseQuizRepository(db);
    const quiz = await repo.createQuiz(lessons[0]);
    const q = await repo.saveQuestion(quiz.id, null, { prompt: "One?", allowsMultiple: false, options: [{ label: "Yes", isCorrect: true }, { label: "No", isCorrect: false }] });
    await repo.deleteQuestion(quiz.id, q);
    const orphans = await db.from("quiz_options").select("id").eq("question_id", q);
    expect(orphans.data).toEqual([]);
    await clear();
  });
});

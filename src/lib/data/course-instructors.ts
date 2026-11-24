import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { compareText, must } from "./query";

/**
 * The members who teach each course (`course_instructors`, docs/product/COURSES.md, "Lesson comments"): the people whose lesson
 * comments carry the Instructor badge. A course has any number of them, edited by admins in the course settings. Reads and writes
 * run as the client's role: an admin's own client writes (row-level security allows only admins, and the audit log names them),
 * the server's service role reads. Throws on a database error.
 */
export interface CourseInstructorRepository {
  /** The members who teach the course, as member ids in a stable order (empty when none is set). */
  forCourse(courseId: string): Promise<string[]>;
  /** Whether the member is one of the course's instructors. */
  isInstructor(courseId: string, memberId: string): Promise<boolean>;
  /**
   * Makes the course's instructors exactly `memberIds`: adds the missing ones and removes the rest, each one row (so one audit entry
   * per change). Returns what changed; nothing is written, and both lists are empty, when the course already has exactly these.
   * Throws when a member or the course does not exist (the database refuses the row).
   */
  set(courseId: string, memberIds: string[]): Promise<{ added: string[]; removed: string[] }>;
}

export class SupabaseCourseInstructorRepository implements CourseInstructorRepository {
  constructor(private readonly db: Db) {}

  async forCourse(courseId: string) {
    const rows = must(await this.db.from("course_instructors").select("member_id").eq("course_id", courseId).order("member_id")) ?? [];
    return rows.map((r) => r.member_id);
  }

  async isInstructor(courseId: string, memberId: string) {
    const row = must(await this.db.from("course_instructors").select("id").eq("course_id", courseId).eq("member_id", memberId).maybeSingle());
    return Boolean(row);
  }

  async set(courseId: string, memberIds: string[]) {
    const wanted = [...new Set(memberIds)];
    const current = new Set(await this.forCourse(courseId));
    const added = wanted.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !wanted.includes(id));
    if (added.length > 0) must(await this.db.from("course_instructors").insert(added.map((member_id) => ({ course_id: courseId, member_id }))));
    if (removed.length > 0) must(await this.db.from("course_instructors").delete().eq("course_id", courseId).in("member_id", removed));
    return { added, removed };
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryCourseInstructorRepository implements CourseInstructorRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async forCourse(courseId: string) {
    return this.data.courseInstructors
      .filter((r) => r.course_id === courseId)
      .map((r) => r.member_id)
      .sort(compareText);
  }

  async isInstructor(courseId: string, memberId: string) {
    return this.data.courseInstructors.some((r) => r.course_id === courseId && r.member_id === memberId);
  }

  async set(courseId: string, memberIds: string[]) {
    const wanted = [...new Set(memberIds)];
    if (!this.data.courses.some((c) => c.id === courseId)) throw new Error('insert or update on table "course_instructors" violates foreign key constraint "course_instructors_course_id_fkey"');
    for (const id of wanted) {
      if (!this.data.members.some((m) => m.id === id)) throw new Error('insert or update on table "course_instructors" violates foreign key constraint "course_instructors_member_id_fkey"');
    }
    const current = new Set(await this.forCourse(courseId));
    const added = wanted.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !wanted.includes(id));
    let next = this.data.courseInstructors.length;
    for (const member_id of added) {
      // The next free id, so a removed row's id is never made again.
      let id: string;
      do id = `cinst_${String(++next).padStart(12, "A")}`;
      while (this.data.courseInstructors.some((r) => r.id === id));
      this.data.courseInstructors.push({
        id,
        course_id: courseId,
        member_id,
        created_at: new Date().toISOString(),
      });
    }
    this.data.courseInstructors = this.data.courseInstructors.filter((r) => !(r.course_id === courseId && removed.includes(r.member_id)));
    return { added, removed };
  }
}

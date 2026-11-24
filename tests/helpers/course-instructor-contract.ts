import { describe, it, expect, beforeEach } from "vitest";
import type { CourseInstructorRepository } from "@/lib/data/course-instructors";

export type CourseInstructorContractContext = {
  repo: () => CourseInstructorRepository;
  /** Two courses that exist. */
  courses: [string, string];
  /** Three members that exist. */
  members: [string, string, string];
  /** Removes every instructor row this context's courses have. */
  clear: () => Promise<void>;
};

/** Behavior every `CourseInstructorRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCourseInstructorContract(name: string, setup: () => CourseInstructorContractContext) {
  describe(`${name} (CourseInstructorRepository contract)`, () => {
    let ctx: CourseInstructorContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("has no instructors until some are set", async () => {
      expect(await ctx.repo().forCourse(ctx.courses[0])).toEqual([]);
      expect(await ctx.repo().isInstructor(ctx.courses[0], ctx.members[0])).toBe(false);
    });

    it("sets the list, telling what was added and removed, and a repeat writes nothing", async () => {
      const [ada, bea, cara] = ctx.members;
      expect(await ctx.repo().set(ctx.courses[0], [ada, bea])).toEqual({ added: [ada, bea], removed: [] });
      expect([...(await ctx.repo().forCourse(ctx.courses[0]))].sort()).toEqual([ada, bea].sort());

      expect(await ctx.repo().set(ctx.courses[0], [bea, ada])).toEqual({ added: [], removed: [] });
      expect(await ctx.repo().set(ctx.courses[0], [bea, cara])).toEqual({ added: [cara], removed: [ada] });
      expect([...(await ctx.repo().forCourse(ctx.courses[0]))].sort()).toEqual([bea, cara].sort());
      expect(await ctx.repo().set(ctx.courses[0], [])).toEqual({ added: [], removed: expect.arrayContaining([bea, cara]) });
      expect(await ctx.repo().forCourse(ctx.courses[0])).toEqual([]);
    });

    it("counts a member listed twice once", async () => {
      const [ada] = ctx.members;
      expect(await ctx.repo().set(ctx.courses[0], [ada, ada])).toEqual({ added: [ada], removed: [] });
      expect(await ctx.repo().forCourse(ctx.courses[0])).toEqual([ada]);
    });

    it("keeps each course's instructors apart", async () => {
      const [ada, bea] = ctx.members;
      await ctx.repo().set(ctx.courses[0], [ada]);
      await ctx.repo().set(ctx.courses[1], [bea]);

      expect(await ctx.repo().isInstructor(ctx.courses[0], ada)).toBe(true);
      expect(await ctx.repo().isInstructor(ctx.courses[0], bea)).toBe(false);
      expect(await ctx.repo().isInstructor(ctx.courses[1], bea)).toBe(true);
      await ctx.repo().set(ctx.courses[0], []);
      expect(await ctx.repo().forCourse(ctx.courses[1])).toEqual([bea]);
    });

    it("refuses a member or a course that does not exist", async () => {
      await expect(ctx.repo().set(ctx.courses[0], ["mbr_ZZZZZZZZZZZZ"])).rejects.toThrow();
      await expect(ctx.repo().set("crs_ZZZZZZZZZZZZ", [ctx.members[0]])).rejects.toThrow();
      expect(await ctx.repo().forCourse(ctx.courses[0])).toEqual([]);
    });
  });
}

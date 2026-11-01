import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow } from "@/tests/helpers/course-fixtures";
import { resolveCourseParam } from "@/lib/courses/course-param";
import { loadAdminCourseTitle } from "@/lib/courses/admin";

const ID = "crs_AAAAAAAAAAA1";
const repos = () => createInMemoryRepos(new InMemoryDataset({ courses: [courseRow({ id: ID, slug: "the-ready-writer", title: "The Ready Writer" })] }));

describe("resolveCourseParam", () => {
  it("keeps a course id as it is", async () => {
    expect(await resolveCourseParam(repos(), ID)).toBe(ID);
    // An id is not looked up: one that isn't in the Hub is the caller's 404.
    expect(await resolveCourseParam(repos(), "crs_BBBBBBBBBBB2")).toBe("crs_BBBBBBBBBBB2");
  });

  it("turns a course's slug into its id, so a member's course address with /admin in front opens", async () => {
    expect(await resolveCourseParam(repos(), "the-ready-writer")).toBe(ID);
  });

  it("returns an unknown slug as it came, for a 404", async () => {
    expect(await resolveCourseParam(repos(), "no-such-course")).toBe("no-such-course");
  });
});

describe("the admin loaders take the slug", () => {
  it("finds the course's title by slug or id", async () => {
    expect(await loadAdminCourseTitle(repos(), "the-ready-writer")).toBe("The Ready Writer");
    expect(await loadAdminCourseTitle(repos(), ID)).toBe("The Ready Writer");
    expect(await loadAdminCourseTitle(repos(), "no-such-course")).toBeNull();
  });
});

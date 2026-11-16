import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow } from "@/tests/helpers/course-fixtures";
import { permanentRedirect } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
const currentPath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gates.server", () => ({ currentPath }));

import { courseRedirectSlug, redirectOldCourseAddress, searchSuffix, withCourseAddress } from "@/lib/courses/address-redirect";

const COURSE = "crs_AAAAAAAAAAA1";
const asMember = { isAdminActing: false };
const asStaff = { isAdminActing: true };

/** A published course that used to be at /courses/old-name. */
function repos(over: { is_draft?: boolean } = {}) {
  const dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "new-name", title: "New Name", ...over })],
    courseAddressRedirects: [{ id: "cslug_AAAAAAAAAAA1", address: "old-name", course_id: COURSE, created_at: "2097-01-01T00:00:00.000Z" }],
  });
  return createInMemoryRepos(dataset);
}

beforeEach(() => {
  permanentRedirect.mockClear();
  currentPath.mockReset();
});

describe("withCourseAddress", () => {
  it("swaps the course address and keeps the rest of the path and the query", () => {
    expect(withCourseAddress("/courses/old-name", "old-name", "new-name")).toBe("/courses/new-name");
    expect(withCourseAddress("/courses/old-name?x=1", "old-name", "new-name")).toBe("/courses/new-name?x=1");
    expect(withCourseAddress("/courses/old-name/lessons/les_AAAAAAAAAAA1?t=90&track=1", "old-name", "new-name")).toBe("/courses/new-name/lessons/les_AAAAAAAAAAA1?t=90&track=1");
  });

  it("doesn't touch a path that isn't under that address", () => {
    expect(withCourseAddress(null, "old-name", "new-name")).toBeNull();
    expect(withCourseAddress("/courses/old-name-two/lessons/x", "old-name", "new-name")).toBeNull();
    expect(withCourseAddress("/admin/courses/old-name", "old-name", "new-name")).toBeNull();
  });
});

describe("searchSuffix", () => {
  it("turns search params into a query string, or nothing", () => {
    expect(searchSuffix(undefined)).toBe("");
    expect(searchSuffix({})).toBe("");
    expect(searchSuffix({ t: "90", tag: ["a", "b"], skipped: undefined })).toBe("?t=90&tag=a&tag=b");
  });
});

describe("courseRedirectSlug", () => {
  it("gives the course's current address for an old one", async () => {
    expect(await courseRedirectSlug(repos(), "old-name", asMember)).toBe("new-name");
  });

  it("gives nothing for an address that isn't an old one, including a current one", async () => {
    expect(await courseRedirectSlug(repos(), "new-name", asMember)).toBeNull();
    expect(await courseRedirectSlug(repos(), "never-existed", asMember)).toBeNull();
  });

  it("doesn't give away a draft's current address to anyone but staff acting as themselves", async () => {
    expect(await courseRedirectSlug(repos({ is_draft: true }), "old-name", asMember)).toBeNull();
    expect(await courseRedirectSlug(repos({ is_draft: true }), "old-name", asStaff)).toBe("new-name");
  });
});

describe("redirectOldCourseAddress", () => {
  it("sends an old address permanently to the same page at the current one, as it was asked for", async () => {
    currentPath.mockResolvedValue("/courses/old-name/lessons/les_AAAAAAAAAAA1?t=90");
    await expect(redirectOldCourseAddress(repos(), "old-name", asMember, "/lessons/les_AAAAAAAAAAA1")).rejects.toMatchObject({ digest: expect.stringContaining(";308;") });
    expect(permanentRedirect).toHaveBeenCalledWith("/courses/new-name/lessons/les_AAAAAAAAAAA1?t=90");
  });

  it("falls back to the page's own rest of the path when the proxy didn't pass the address along", async () => {
    currentPath.mockResolvedValue(null);
    await expect(redirectOldCourseAddress(repos(), "old-name", asMember, "/modules/mod_AAAAAAAAAAA1")).rejects.toBeDefined();
    expect(permanentRedirect).toHaveBeenCalledWith("/courses/new-name/modules/mod_AAAAAAAAAAA1");
  });

  it("returns, for the caller to answer not found, when it isn't an old address or the course is hidden from the caller", async () => {
    currentPath.mockResolvedValue("/courses/nothing");
    await redirectOldCourseAddress(repos(), "nothing", asMember, "");
    await redirectOldCourseAddress(repos({ is_draft: true }), "old-name", asMember, "");
    expect(permanentRedirect).not.toHaveBeenCalled();
  });
});

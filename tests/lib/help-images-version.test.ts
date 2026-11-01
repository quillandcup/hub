import { describe, expect, it } from "vitest";
import { HELP_IMAGE_INPUTS, contentId, helpImagesVersion, pickSet, versionFromTrees } from "@/scripts/help-images-version";
import { listSets } from "@/scripts/help-images-sets";
import { HELP_IMAGES_VERSION, helpImageObjectPath } from "@/lib/help";

const trees = () => (_rev: string, path: string) => `tree-${path}`;

describe("versionFromTrees", () => {
  it("is twelve hex characters and ignores the order the paths are given in", () => {
    const a = versionFromTrees({ app: "1", lib: "2" });
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(versionFromTrees({ lib: "2", app: "1" })).toBe(a);
  });

  it("changes when any tree changes, and when a path is added", () => {
    const base = versionFromTrees({ app: "1", lib: "2" });
    expect(versionFromTrees({ app: "1", lib: "3" })).not.toBe(base);
    expect(versionFromTrees({ app: "1", lib: "2", demo: "4" })).not.toBe(base);
  });
});

describe("contentId", () => {
  it("is the same for two commits whose screen-affecting source is identical", () => {
    // Only docs, tests or help text differ between the commits, so none of the input trees differ.
    expect(contentId("a", trees())).toBe(contentId("b", trees()));
  });

  it.each(HELP_IMAGE_INPUTS)("changes when %s changes", (path) => {
    expect(contentId("a", (_rev, p) => (p === path ? "changed" : `tree-${p}`))).not.toBe(contentId("a", trees()));
  });

  it("skips a path the commit doesn't have, and is null when git knows none of them", () => {
    expect(contentId("a", (_rev, p) => (p === "app" ? "x" : null))).toMatch(/^[0-9a-f]{12}$/);
    expect(contentId("a", () => null)).toBeNull();
  });
});

describe("pickSet", () => {
  const sha = (n: string) => `${n.padEnd(12, "0")}${"f".repeat(28)}`;
  // newest first, like `git rev-list HEAD`
  const history = [sha("eee"), sha("ddd"), sha("ccc"), sha("bbb"), sha("aaa")];

  it("is the newest set whose commit is an ancestor", () => {
    expect(pickSet(["aaa000000000", "ccc000000000"], history)).toBe("ccc000000000");
    expect(pickSet(["aaa000000000", "ccc000000000", "eee000000000"], history)).toBe("eee000000000");
  });

  it("ignores a set captured at a commit that isn't in this history (a rollback to before it, or a branch)", () => {
    expect(pickSet(["fff000000000", "bbb000000000"], history)).toBe("bbb000000000");
  });

  it("ignores folders that aren't a commit-named set, and is null when nothing matches", () => {
    expect(pickSet(["not-a-set", "123"], history)).toBeNull();
    expect(pickSet(["fff000000000"], history)).toBeNull();
    expect(pickSet([], history)).toBeNull();
  });
});

describe("helpImagesVersion", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("is 'local' outside CI, so dev and the demo stack need nothing set", () => {
    expect(helpImagesVersion({})).toBe("local");
    expect(helpImagesVersion({ GITHUB_ACTIONS: "true" })).toBe("local");
  });

  it("is the commit in CI, the name a published set gets", () => {
    expect(helpImagesVersion({ GITHUB_ACTIONS: "true", GITHUB_SHA: sha })).toBe("0123456789ab");
  });

  it("takes an explicit HELP_IMAGES_VERSION over everything", () => {
    expect(helpImagesVersion({ GITHUB_ACTIONS: "true", GITHUB_SHA: sha, HELP_IMAGES_VERSION: "pinned" })).toBe("pinned");
  });
});

describe("listSets", () => {
  const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the commit-named folders, not files or other names", async () => {
    const sets = await listSets("http://x", "key", respond([
      { name: "0123456789ab", id: null },
      { name: "README", id: null },
      { name: "fedcba987654", id: "file-id" },
    ]));
    expect(sets).toEqual(["0123456789ab"]);
  });

  it("throws on an error response instead of reporting no sets", async () => {
    await expect(listSets("http://x", "key", respond({}, 500))).rejects.toThrow("HTTP 500");
  });
});

describe("where a build looks for its images", () => {
  it("is the set folder, then scene, then file", () => {
    expect(helpImageObjectPath("join-a-prickle", "01-dashboard.png", "abc123")).toBe("abc123/join-a-prickle/01-dashboard.png");
    expect(helpImageObjectPath("join-a-prickle", "01-dashboard.png")).toBe(`${HELP_IMAGES_VERSION}/join-a-prickle/01-dashboard.png`);
  });
});

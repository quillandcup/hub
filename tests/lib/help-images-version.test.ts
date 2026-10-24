import { describe, expect, it } from "vitest";
import { HELP_IMAGE_INPUTS, helpImagesVersion, versionFromTrees } from "@/scripts/help-images-version";
import { HELP_IMAGES_VERSION, helpImageObjectPath } from "@/lib/help";

const trees = (overrides: Record<string, string> = {}) => (path: string) => overrides[path] ?? `tree-${path}`;

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

describe("helpImagesVersion", () => {
  const ci = { GITHUB_ACTIONS: "true" };

  it("is 'local' outside CI, so dev and the demo stack need nothing set", () => {
    expect(helpImagesVersion({}, trees())).toBe("local");
  });

  it("is the same for two commits whose screen-affecting source is identical", () => {
    // Only docs, tests or help text differ between the commits, so none of the input trees differ.
    expect(helpImagesVersion(ci, trees())).toBe(helpImagesVersion(ci, trees()));
  });

  it.each(HELP_IMAGE_INPUTS)("changes when %s changes", (path) => {
    expect(helpImagesVersion(ci, trees({ [path]: "changed" }))).not.toBe(helpImagesVersion(ci, trees()));
  });

  it("skips a path the commit doesn't have, and falls back to 'local' when git knows none of them", () => {
    expect(helpImagesVersion(ci, (p) => (p === "app" ? "x" : null))).toMatch(/^[0-9a-f]{12}$/);
    expect(helpImagesVersion(ci, () => null)).toBe("local");
  });

  it("takes an explicit HELP_IMAGES_VERSION over everything", () => {
    expect(helpImagesVersion({ ...ci, HELP_IMAGES_VERSION: "pinned" }, trees())).toBe("pinned");
  });
});

describe("where a build looks for its images", () => {
  it("is the set folder, then scene, then file", () => {
    expect(helpImageObjectPath("join-a-prickle", "01-dashboard.png", "abc123")).toBe("abc123/join-a-prickle/01-dashboard.png");
    expect(helpImageObjectPath("join-a-prickle", "01-dashboard.png")).toBe(`${HELP_IMAGES_VERSION}/join-a-prickle/01-dashboard.png`);
  });
});

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Which help screenshot set a build shows.
 *
 * Sets are captured by the scheduled `Help screenshots` workflow (not on every merge: a capture takes minutes and
 * would sit in front of every deploy). A set is named by the first twelve characters of the main commit it was
 * captured at. A deploy of commit M shows the newest set whose commit is an ancestor of M (`pickSet`), so:
 *
 *  - commits between two captures show the earlier one;
 *  - a build bakes its set id in at deploy time (next.config.ts), so a rollback keeps showing the set it was
 *    deployed with, and a redeploy of an old commit picks the newest set from before it;
 *  - a new set only reaches production when the build after it bakes it in, which is why the workflow that
 *    publishes one also starts a deploy.
 *
 * `contentId` is a hash of the source that decides what the screens look like (the app, its components and lib,
 * the demo scenes and seed, the styles, the dependency lockfile, the migrations), from git's own tree hashes. The
 * workflow skips a capture when HEAD's content id equals that of the newest published set's commit.
 *
 * `helpImagesVersion()` is what the publish step names a set: the commit in CI, "local" outside it (so `next dev`
 * and the demo stack need nothing set). `HELP_IMAGES_VERSION` in the environment overrides it; the deploy job
 * sets it to the picked set. See docs/DEMO_AND_HELP.md.
 */
export const HELP_IMAGE_INPUTS = [
  "app",
  "components",
  "lib",
  "demo",
  "public",
  "supabase/migrations",
  "app.config.ts",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "postcss.config.mjs",
  "tailwind.config.ts",
];

/** A set's folder name: twelve characters of a commit sha. */
export const SET_ID = /^[0-9a-f]{12}$/;

/** The id for a set of `path -> git tree (or blob) hash` entries: order-independent, twelve hex characters. */
export function versionFromTrees(entries: Record<string, string>): string {
  const lines = Object.keys(entries)
    .sort()
    .map((path) => `${path}=${entries[path]}`);
  return createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);
}

function gitHash(rev: string, path: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", `${rev}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The screen-affecting source at `rev`, as an id: equal for two commits that would produce the same screenshots. */
export function contentId(rev: string, hash: (rev: string, path: string) => string | null = gitHash): string | null {
  const entries: Record<string, string> = {};
  for (const path of HELP_IMAGE_INPUTS) {
    const h = hash(rev, path);
    if (h) entries[path] = h;
  }
  return Object.keys(entries).length > 0 ? versionFromTrees(entries) : null;
}

/**
 * The newest set that is an ancestor of the commit `ancestry` starts at. `ancestry` is `git rev-list` order (newest
 * first); `sets` are the folder names in the bucket. Names that aren't a commit in the history (sets from before sets
 * were named by commit) never match. Null when no set is an ancestor.
 */
export function pickSet(sets: string[], ancestry: string[]): string | null {
  const have = new Set(sets.filter((s) => SET_ID.test(s)));
  for (const sha of ancestry) {
    const id = sha.slice(0, 12);
    if (have.has(id)) return id;
  }
  return null;
}

export function helpImagesVersion(env: Record<string, string | undefined> = process.env): string {
  if (env.HELP_IMAGES_VERSION) return env.HELP_IMAGES_VERSION;
  if (!env.GITHUB_ACTIONS || !env.GITHUB_SHA) return "local";
  return env.GITHUB_SHA.slice(0, 12);
}

if (process.argv[1]?.endsWith("help-images-version.ts")) console.log(helpImagesVersion());

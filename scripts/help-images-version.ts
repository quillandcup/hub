import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * The id of the help screenshot set a build is paired with. It is a hash of the source that decides what the
 * screens look like (the app, its components and lib, the demo scenes and seed, the styles, the dependency
 * lockfile, the migrations), taken from git's own tree hashes. So:
 *
 *  - a commit that doesn't touch those paths (docs, tests, help text, CI config) has the same id as its parent,
 *    and nothing is captured or uploaded again;
 *  - a commit that does touch them gets a new id, and the images are captured once for it;
 *  - the build and the images it shows are paired by construction, with no version file to bump and no bot
 *    commits, and an older deploy still points at its own set, so a rollback shows matching images.
 *
 * Used by next.config.ts (which bakes it into the build), the publish job and `pnpm demo:publish`, all of which
 * run on the same commit in CI. Outside CI it is "local", so `next dev` and the demo stack need nothing set.
 * `HELP_IMAGES_VERSION` in the environment overrides it. See docs/DEMO_AND_HELP.md.
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

/** The id for a set of `path -> git tree (or blob) hash` entries: order-independent, twelve hex characters. */
export function versionFromTrees(entries: Record<string, string>): string {
  const lines = Object.keys(entries)
    .sort()
    .map((path) => `${path}=${entries[path]}`);
  return createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);
}

function gitHash(path: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", `HEAD:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function helpImagesVersion(
  env: Record<string, string | undefined> = process.env,
  hash: (path: string) => string | null = gitHash,
): string {
  if (env.HELP_IMAGES_VERSION) return env.HELP_IMAGES_VERSION;
  if (!env.GITHUB_ACTIONS) return "local";
  const entries: Record<string, string> = {};
  for (const path of HELP_IMAGE_INPUTS) {
    const h = hash(path);
    if (h) entries[path] = h;
  }
  return Object.keys(entries).length > 0 ? versionFromTrees(entries) : "local";
}

if (process.argv[1]?.endsWith("help-images-version.ts")) console.log(helpImagesVersion());

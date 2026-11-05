import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import path from "node:path";
import type { ChangelogEntry } from "@/lib/changelog/entries";
import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";
import { isChangelogSlug } from "@/lib/changelog";

/**
 * Where a changelog entry's screenshots come from and go (`pnpm changelog:capture <slug>`, docs/CHANGELOG_PROCESS.md): a
 * demo scene named for the entry, captured on one project, then copied into the entry's folder in public/ to be reviewed
 * and committed. Kept apart from the Playwright run so the paths and the checks can be tested without a browser.
 */

/** The one project a changelog screenshot is taken on: desktop, light. */
export const CAPTURE_PROJECT = "desktop-light";

/**
 * What a committed screenshot looks like: WebP, at most this wide. A 1440 px PNG of the app is 100 KB or more and the
 * repo keeps every version forever; at this size and quality it is a fraction of that and still reads clearly in the
 * list, the digest, the Slack post and on a phone.
 */
export const SCREENSHOT_MAX_WIDTH = 1200;
export const SCREENSHOT_QUALITY = 80;

/** PNG bytes to the committed form: WebP, never upscaled, no wider than SCREENSHOT_MAX_WIDTH. */
export async function toCommittedScreenshot(png: Buffer): Promise<Buffer> {
  return sharp(png).resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true }).webp({ quality: SCREENSHOT_QUALITY }).toBuffer();
}

/** The tag every changelog scene carries, so the scheduled help-screenshots run can leave them out. */
export const CHANGELOG_SCENE_TAG = "@changelog";

export const sceneFile = (slug: string) => path.join("demo", "scenes", "changelog", `${slug}.spec.ts`);

/** Where the capture run writes (`shot()` names the folder after the scene file). */
export const captureDir = (slug: string) => path.join("demo", "out", slug, CAPTURE_PROJECT);

/** Where the entry's screenshots are committed, and served from at `/changelog/<slug>/<file>`. */
export const publicDir = (slug: string, root: string = process.cwd()) => path.join(root, "public", "changelog", slug);

/** The screenshots in a capture folder, by name (not the page-check findings written beside them). */
export function capturedImages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[a-z0-9][a-z0-9-]*\.png$/.test(f))
    .sort();
}

/** Why a slug can't be captured, or null when it can: it must name a product entry (engineering entries show no screenshots) with a scene. */
export function captureProblem(slug: string, entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES, root: string = process.cwd()): string | null {
  if (!isChangelogSlug(slug)) return `"${slug}" is not a changelog slug (lowercase words and hyphens)`;
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) return `No changelog entry has the slug "${slug}": add the entry to lib/changelog/entries.ts first`;
  if (entry.audience !== "product") return `"${slug}" is an engineering entry, which has no screenshots`;
  if (!existsSync(path.join(root, sceneFile(slug)))) return `No scene at ${sceneFile(slug)}: write one (see demo/scenes/changelog/ for an example)`;
  return null;
}

/** Every image an entry shows: its list image and the ones in its body. */
export function entryImagePaths(entry: ChangelogEntry): string[] {
  const inBody = [...entry.body.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map((m) => m[1]);
  return [...new Set([...(entry.image ? [entry.image.src] : []), ...inBody])];
}

/** Images an entry shows that are not in public/ (a typo, or a capture that was never committed). */
export function missingImageFiles(entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES, root: string = process.cwd()): string[] {
  return entries
    .filter((e) => e.audience === "product")
    .flatMap((e) => entryImagePaths(e).map((src) => ({ slug: e.slug, src })))
    .filter(({ src }) => !existsSync(path.join(root, "public", src)))
    .map(({ slug, src }) => `${slug}: ${src}`);
}

/** The Playwright arguments that run one entry's scene on the capture project. */
export const playwrightArgs = (slug: string): string[] => [
  "exec", "playwright", "test", "--config", "demo/playwright.config.ts", "--project", CAPTURE_PROJECT, "--grep", CHANGELOG_SCENE_TAG, sceneFile(slug),
];

export type CaptureResult = { ok: true; copied: string[]; target: string } | { ok: false; error: string };

/**
 * Captures an entry's screenshots: clears the earlier capture folder (so a screenshot a scene no longer takes can't be
 * copied from an old run), runs the scene through `run` (the Playwright command; its exit status), and writes the PNGs it
 * took into public/changelog/<slug>/ as WebP (`convert`, resized and compressed), replacing only the images of an earlier
 * capture. Nothing is written when the scene fails.
 */
export async function captureEntry(
  slug: string,
  run: (args: string[]) => number,
  {
    entries = CHANGELOG_ENTRIES,
    root = process.cwd(),
    convert = toCommittedScreenshot,
  }: { entries?: readonly ChangelogEntry[]; root?: string; convert?: (png: Buffer) => Promise<Buffer> } = {},
): Promise<CaptureResult> {
  const problem = captureProblem(slug, entries, root);
  if (problem) return { ok: false, error: problem };

  rmSync(path.join(root, "demo", "out", slug), { recursive: true, force: true });
  const status = run(playwrightArgs(slug));
  if (status !== 0) return { ok: false, error: `The scene failed (exit ${status}); nothing was copied.` };

  const from = path.join(root, captureDir(slug));
  const images = capturedImages(from);
  if (images.length === 0) return { ok: false, error: `The scene ran but took no screenshots (${captureDir(slug)}).` };

  const target = publicDir(slug, root);
  mkdirSync(target, { recursive: true });
  for (const f of readdirSync(target)) if (/\.(png|webp)$/.test(f)) rmSync(path.join(target, f));
  const copied: string[] = [];
  for (const f of images) {
    const name = f.replace(/\.png$/, ".webp");
    writeFileSync(path.join(target, name), await convert(await readFile(path.join(from, f))));
    copied.push(name);
  }
  return { ok: true, copied, target };
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { captureEntry } from "@/lib/changelog/capture";

/**
 * `pnpm changelog:capture <slug>`: runs the entry's demo scene (demo/scenes/changelog/<slug>.spec.ts) on desktop light
 * against the demo app (`pnpm demo:stack up`, `pnpm demo:app`, `pnpm demo:seed` first, docs/DEMO_AND_HELP.md), then copies
 * the screenshots into public/changelog/<slug>/ (lib/changelog/capture.ts). It touches nothing else and never a real
 * environment: the demo stack is a fictional community. Review the images before committing: the repo is public.
 */
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: pnpm changelog:capture <slug>");
  process.exit(1);
}

const result = captureEntry(slug, (args) => spawnSync("pnpm", args, { stdio: "inherit" }).status ?? 1);
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(`\nCopied ${result.copied.length} screenshot(s) to ${path.relative(process.cwd(), result.target)}:`);
for (const f of result.copied) console.log(`  /changelog/${slug}/${f}`);
console.log("\nOpen them and check there is no real member data, delete any the entry does not use, then reference them from the entry (image, and ![alt](/changelog/<slug>/<file>) in the body).");

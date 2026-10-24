/**
 * Uploads the captured screenshots the help articles use to the private help-images bucket, so the deployed
 * /help pages can show them (lib/help.ts, app/(member)/help/images). Desktop in light mode is the published set.
 *
 *   pnpm demo:publish          to the demo stack (what `pnpm demo:app` serves)
 *   pnpm demo:publish --prod   to production, using .env.prod / .env.shared. Writes to production storage:
 *                              run it yourself after reviewing demo/out, never from an automated session.
 *
 * Capture first: `pnpm demo:capture --project=desktop-light`.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTargetEnv } from "../scripts/env-files";
import { HELP_IMAGES_BUCKET, isHelpImagePath, listHelpArticles } from "../lib/help";
import { loadDemoEnv } from "./env";

export const PUBLISHED_PROJECT = "desktop-light";

export interface Upload {
  local: string;
  remote: string;
}

/** The `<scene>/<file>.png` names the articles in help/ show. */
export function referencedImages(): Set<string> {
  const refs = new Set<string>();
  for (const a of listHelpArticles()) for (const m of a.body.matchAll(/\(img:([a-z0-9-]+\/[^)]+)\)/g)) refs.add(m[1]);
  return refs;
}

/** The screenshots to publish: demo/out/<scene>/desktop-light/<file>.png goes to <scene>/<file>.png. Files whose names the image route would refuse are skipped, and with `only`, so is anything no article shows. */
export function publishPlan(outDir: string, only?: Set<string>): Upload[] {
  if (!existsSync(outDir)) return [];
  const uploads: Upload[] = [];
  for (const scene of readdirSync(outDir).sort()) {
    const dir = path.join(outDir, scene, PUBLISHED_PROJECT);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (isHelpImagePath(scene, file) && (!only || only.has(`${scene}/${file}`))) uploads.push({ local: path.join(dir, file), remote: `${scene}/${file}` });
    }
  }
  return uploads;
}

async function main() {
  const prod = process.argv.includes("--prod");
  let url: string;
  let key: string;
  if (prod) {
    const env = loadTargetEnv("production");
    url = env.NEXT_PUBLIC_SUPABASE_URL;
    key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env.prod / .env.shared");
  } else {
    const env = loadDemoEnv();
    url = env.supabaseUrl;
    key = env.serviceRoleKey;
  }

  const plan = publishPlan(path.join(process.cwd(), "demo", "out"), referencedImages());
  if (plan.length === 0) throw new Error(`Nothing to publish: run \`pnpm demo:capture --project=${PUBLISHED_PROJECT}\` first.`);

  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(HELP_IMAGES_BUCKET);
  console.log(`Publishing ${plan.length} screenshots to ${new URL(url).host} (${prod ? "PRODUCTION" : "demo stack"})`);
  for (const { local, remote } of plan) {
    const { error } = await bucket.upload(remote, readFileSync(local), { contentType: "image/png", upsert: true });
    if (error) throw new Error(`${remote}: ${error.message}`);
    console.log(`  ${remote}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

/**
 * Uploads the captured screenshots the help articles use to the private help-images bucket, so the deployed
 * /help pages can show them (lib/help.ts, app/(member)/help/images). Desktop in light mode is the published set.
 * Each set lives in its own folder, named by the main commit it was captured at, and a build shows the newest set
 * captured at or before it (scripts/help-images-version.ts, docs/DEMO_AND_HELP.md).
 *
 *   pnpm demo:publish                 to the demo stack (what `pnpm demo:app` serves), into the "local" set
 *   pnpm demo:publish --verify        no upload: check every screenshot an article shows was captured
 *   pnpm demo:publish --from-env      to the Supabase project in NEXT_PUBLIC_SUPABASE_URL and
 *                                     SUPABASE_SERVICE_ROLE_KEY (CI: the scheduled Help screenshots workflow)
 *   pnpm demo:publish --prod          to production, from .env.prod / .env.shared. Writes to production storage:
 *                                     for a person to run, never an automated session.
 *   --prune --keep-days=30           after uploading, delete the sets older than 30 days, except the newest of them
 *                                     (a deploy from before that still shows something) and this one
 *
 * Capture first: `pnpm demo:capture --project=desktop-light`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTargetEnv } from "../scripts/env-files";
import { SET_ID, helpImagesVersion } from "../scripts/help-images-version";
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

/** Screenshots an article shows that no scene captured: a renamed step, a scene that didn't run, or an article ahead of its scene. */
export function missingImages(plan: Upload[], wanted: Set<string>): string[] {
  const have = new Set(plan.map((u) => u.remote));
  return [...wanted].filter((ref) => !have.has(ref)).sort();
}

/**
 * The sets to delete: those older than `keepDays`, except the newest of them (a deploy or rollback from before the
 * window still resolves to a set) and `current`. A deploy bakes in the newest set before its commit, so sets stay
 * as long as a deploy that could use them.
 */
export function setsToPrune(sets: { name: string; newest: number }[], keepDays: number, current: string, now: number): string[] {
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  const old = sets.filter((s) => s.newest < cutoff && s.name !== current).sort((a, b) => b.newest - a.newest);
  return old.slice(1).map((s) => s.name);
}

async function listFiles(bucket: ReturnType<SupabaseClient["storage"]["from"]>, prefix: string): Promise<{ path: string; created: number }[]> {
  const files: { path: string; created: number }[] = [];
  const { data, error } = await bucket.list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix}: ${error.message}`);
  for (const entry of data ?? []) {
    if (entry.id) files.push({ path: `${prefix}/${entry.name}`, created: Date.parse(entry.created_at ?? "") || 0 });
    else files.push(...(await listFiles(bucket, `${prefix}/${entry.name}`)));
  }
  return files;
}

async function prune(bucket: ReturnType<SupabaseClient["storage"]["from"]>, keepDays: number, current: string) {
  const { data, error } = await bucket.list("", { limit: 1000 });
  if (error) throw new Error(`list sets: ${error.message}`);
  const sets: { name: string; newest: number; files: string[] }[] = [];
  for (const entry of (data ?? []).filter((e) => !e.id && SET_ID.test(e.name))) {
    const files = await listFiles(bucket, entry.name);
    sets.push({ name: entry.name, newest: Math.max(0, ...files.map((f) => f.created)), files: files.map((f) => f.path) });
  }
  for (const name of setsToPrune(sets, keepDays, current, Date.now())) {
    const { error: removeError } = await bucket.remove(sets.find((s) => s.name === name)!.files);
    if (removeError) throw new Error(`remove ${name}: ${removeError.message}`);
    console.log(`  pruned set ${name}`);
  }
}

function connection(args: string[]): { url: string; key: string; label: string } {
  if (args.includes("--prod")) {
    const env = loadTargetEnv("production");
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env.prod / .env.shared");
    return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, label: "PRODUCTION" };
  }
  if (args.includes("--from-env")) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("--from-env needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment");
    return { url, key, label: "environment" };
  }
  const env = loadDemoEnv();
  return { url: env.supabaseUrl, key: env.serviceRoleKey, label: "demo stack" };
}

async function main() {
  const args = process.argv.slice(2);
  const plan = publishPlan(path.join(process.cwd(), "demo", "out"), referencedImages());
  const missing = missingImages(plan, referencedImages());
  if (missing.length > 0) {
    throw new Error(
      `No scene captured these screenshots, which articles in help/ show:\n  ${missing.join("\n  ")}\nRun \`pnpm demo:capture --project=${PUBLISHED_PROJECT}\`, and check each article's img: names against the scene's shot() steps.`,
    );
  }
  if (args.includes("--verify")) {
    console.log(`All ${plan.length} screenshots the articles show were captured.`);
    return;
  }
  if (plan.length === 0) throw new Error(`Nothing to publish: run \`pnpm demo:capture --project=${PUBLISHED_PROJECT}\` first.`);

  const { url, key, label } = connection(args);
  const version = helpImagesVersion();
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(HELP_IMAGES_BUCKET);

  // A set is immutable: if every file is already there (a re-run of the same commit), there is nothing to upload.
  const present = new Set((await listFiles(bucket, version).catch(() => [])).map((f) => f.path.slice(version.length + 1)));
  const todo = plan.filter((u) => !present.has(u.remote));
  console.log(`Set ${version} on ${new URL(url).host} (${label}): ${plan.length - todo.length} already there, ${todo.length} to upload`);
  for (const { local, remote } of todo) {
    const { error } = await bucket.upload(`${version}/${remote}`, readFileSync(local), { contentType: "image/png", upsert: version === "local" });
    if (error) throw new Error(`${remote}: ${error.message}`);
    console.log(`  ${remote}`);
  }

  if (args.includes("--prune")) {
    const keepDays = Number(args.find((a) => a.startsWith("--keep-days="))?.slice(12) ?? 30);
    await prune(bucket, keepDays, version);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

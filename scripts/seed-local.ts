/**
 * Loads a typed seed profile (lib/data/profiles/) into the LOCAL database, for development.
 *
 *   pnpm seed:local -- --profile first-week [--now 2026-10-24T20:00:00Z] [--clear]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local, and refuses any
 * database that is not local (lib/data/seed-loader.ts). Safe to run again: it replaces what the
 * previous run of the same profile wrote. `--clear` only removes it.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORG_TIMEZONE } from "../lib/config";
import type { Database } from "../lib/data/database.types";
import { PROFILE_NAMES, PROFILES, isProfileName } from "../lib/data/profiles/index";
import { assertSeedTarget, clearProfile, loadProfile } from "../lib/data/seed-loader";
import { buildDataset } from "../lib/data/seed-profile";

export function parseArgs(argv: string[]): { profile: string | undefined; now: Date; clear: boolean } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const nowText = value("--now");
  const now = nowText ? new Date(nowText) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now "${nowText}" is not a date`);
  return { profile: value("--profile"), now, clear: argv.includes("--clear") };
}

async function main() {
  const { profile, now, clear } = parseArgs(process.argv.slice(2));
  if (!profile || !isProfileName(profile)) {
    throw new Error(`Usage: pnpm seed:local -- --profile <${PROFILE_NAMES.join("|")}> [--now ISO] [--clear]`);
  }
  config({ path: resolve(process.cwd(), ".env.local") });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assertSeedTarget(url);
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");

  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (clear) {
    await clearProfile(db, profile);
    console.log(`Removed the "${profile}" profile.`);
    return;
  }
  const dataset = buildDataset(PROFILES[profile], now, { timeZone: ORG_TIMEZONE });
  console.log(`Loaded "${profile}":`, await loadProfile(db, dataset, { profile }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

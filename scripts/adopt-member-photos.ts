/**
 * Copies member profile photos from Kajabi's CDN into our own storage (docs/MEDIA_LIBRARY.md, "Member photos").
 *
 * Usage:
 *   pnpm photos:adopt [--env <file>] [--apply]
 *
 * Without --apply it fetches every photo still on a Kajabi host (config: `kajabiPhotoHosts`), checks it decodes as an
 * image and reports counts, writing nothing: read that, then re-run with --apply. Safe to run again: members whose
 * photo already moved, or who chose another, are left alone, and a photo that could not be fetched is tried again.
 * Writes use the service role. The output has counts only.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/data/database.types";
import { createRepos } from "../lib/data/repos";
import { KAJABI_PHOTO_HOSTS } from "../lib/config";
import { MEMBER_PHOTO_BUCKET, memberPhotoPublicUrl } from "../lib/member-photo";
import { adoptMemberPhotos } from "../lib/members/adopt-photos";
import { loadLayeredEnv } from "./load-layered-env";
import { parseAdoptArgs } from "./adopt-book-covers-args";

const USAGE = [
  "Usage: pnpm photos:adopt [--env <file>] [--apply]",
  "  --env    env file with the Supabase URL and service role key (default .env.local); the .env.shared beside it is read too, and the file wins",
  "  --apply  copy the photos (default: fetch them and report what would happen, writing nothing)",
].join("\n");

async function main() {
  const args = parseAdoptArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(`${args.error}\n\n${USAGE}`);
    process.exit(1);
  }
  try {
    loadLayeredEnv(args.envFile);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${args.envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
    process.exit(1);
  }

  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const repos = createRepos(db);
  const bucket = db.storage.from(MEMBER_PHOTO_BUCKET);
  console.log(`${args.apply ? "Copying" : "Reading (nothing will be written)"} member photos from ${KAJABI_PHOTO_HOSTS.join(", ")} in ${new URL(url).host}...`);

  const report = await adoptMemberPhotos(
    {
      members: repos.members,
      memberStatus: repos.memberStatus,
      hosts: KAJABI_PHOTO_HOSTS,
      store: {
        async upload(path, bytes, contentType) {
          const { error } = await bucket.upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
          if (error) throw new Error(error.message);
        },
        publicUrl: (path) => memberPhotoPublicUrl(db, path),
      },
      onProgress: (done, total) => {
        if (done % 10 === 0 || done === total) console.log(`  ${done} / ${total}`);
      },
    },
    { apply: args.apply }
  );

  console.log(`\n${report.considered} member photo(s) are on Kajabi.`);
  console.log(`${report.adopted} ${report.dryRun ? "can be copied" : "copied"}.`);
  console.log(`${report.alreadyAdopted} already had a copy${report.dryRun ? "" : ` (${report.repaired} had their photo address repaired)`}.`);
  if (report.changedMeanwhile > 0) console.log(`${report.changedMeanwhile} changed their photo while this ran and were left alone.`);
  if (report.failedTotal > 0) {
    console.log(`${report.failedTotal} could not be copied and stay as they were (tried again next run):`);
    for (const [reason, count] of Object.entries(report.failed)) console.log(`  ${reason}: ${count}`);
  }
  if (report.dryRun) console.log("\nNothing was written. Re-run with --apply to copy them.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

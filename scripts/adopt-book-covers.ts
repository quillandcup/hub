/**
 * Moves older book covers into the media library (docs/MEDIA_LIBRARY.md, "Older covers").
 *
 * Covers uploaded before the library were cropped to 145 x 215 into the `book-covers` bucket, or are a link to a picture
 * somewhere else. Each one is stored as its member's own library image and the book (or project) is pointed at it, so
 * the Bookshelf size and the Amazon download work. A cover that is only 145 x 215 can't become an Amazon cover (it is
 * too small), but one that was a link to a bigger picture can. The old file in the bucket is left where it is.
 *
 * Usage:
 *   pnpm covers:adopt [--env <file>] [--apply]
 *
 * Links must be https (fetched pinned to the resolved public address, redirects re-checked, 10 MB cap); an http link is
 * not fetched but listed as skipped, with a count, and stays as it was. Re-runs are safe: a moved cover no longer has a
 * link so it is neither downloaded nor touched again, a book or project whose cover the member changed meanwhile is left
 * as it is, the same picture twice is one library image, and anything that failed or was skipped is tried again.
 * A picture that changes at its source after the move is not followed. To pick up new legacy links (for example to
 * stay in step with the public members page), just run it again.
 *
 * Without --apply it reads every cover and reports what it would do (how many, where from, how many would be big
 * enough for Amazon, and which can't be read and why), writing nothing: read that, then re-run with --apply. Safe to
 * run again. Writes use the service role. The output has counts and book or project ids, no names.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/data/database.types";
import { createRepos } from "../lib/data/repos";
import { adoptLegacyCovers } from "../lib/media/adopt-covers";
import { loadLayeredEnv } from "./load-layered-env";
import { ADOPT_USAGE, parseAdoptArgs } from "./adopt-book-covers-args";

async function main() {
  const args = parseAdoptArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(`${args.error}\n\n${ADOPT_USAGE}`);
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
  console.log(`${args.apply ? "Moving" : "Reading (nothing will be written)"} older covers in ${new URL(url).host}...`);

  const report = await adoptLegacyCovers(
    {
      media: repos.media,
      writing: repos.writing,
      books: repos.books,
      storage: db.storage,
      supabaseUrl: url,
      onProgress: (done, total) => {
        if (done % 10 === 0 || done === total) console.log(`  ${done} / ${total}`);
      },
    },
    { apply: args.apply }
  );

  console.log(`\n${report.considered} cover(s) are still a link.`);
  console.log(`${report.adopted} ${report.dryRun ? "can be moved" : "moved"}: ${report.fromOwnBucket} from the old book-covers bucket, ${report.fromLinks} from links to other sites.`);
  console.log(`Of those, ${report.amazonReady} are big enough to become an Amazon cover as they are, ${report.tooSmallForAmazon} are too small (the member has to upload a bigger one).`);
  if (report.skipped.length > 0) {
    console.log(`\n${report.skippedHttp} skipped because the link is plain http (only https is fetched); they stay as they were:`);
    for (const f of report.skipped) console.log(`  ${f.kind} ${f.id}: ${f.reason}`);
  }
  if (report.failed.length > 0) {
    console.log(`\n${report.failed.length} could not be ${report.dryRun ? "moved" : "moved, and stay as they were"}:`);
    for (const f of report.failed) console.log(`  ${f.kind} ${f.id}: ${f.reason}`);
  }
  if (report.dryRun) console.log("\nNothing was written. Re-run with --apply to move them.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

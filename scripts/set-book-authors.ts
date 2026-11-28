/**
 * Puts the author name the old Bookshelf page (/hedgie-books) listed for each book onto the Hub's book as its pen name, so the
 * public Hedgie Bookshelf shows an author line for books that have neither a pen name nor a display name.
 *
 * Usage:
 *   pnpm books:authors --spec <file> [--env <file>] [--skip-with-display-name] [--apply]
 *
 * The spec is a JSON array kept outside the repo (it names people), one object per book:
 *   { "title": "...", "name": "<the name as the old page lists it>", "memberName": "<optional: account or display name>" }
 * `memberName` is only needed when two members have a live book with the same title. `set-book-authors-spec.ts` checks the spec
 * first and lists every problem (a name that is empty, an email, a web address, markup or has digits) before anything is read.
 *
 * Without --apply it reads the live books, writes nothing and prints what it would do. Each entry must find exactly one live book,
 * by title with accents, case and punctuation ignored (and by member when given): none or several are skipped and counted. A pen
 * name is set only on a book that has none (null or empty), in a single conditional update, so a name a member chose is never
 * replaced and a second run changes nothing. `--skip-with-display-name` also leaves alone the books whose member has a display name
 * (the web shows that name already); without it the listed name wins over the display name, and the counts say how many books that changes. Writes use the service role, so the audit log records them as the system. The output
 * has book ids, titles and counts, never a member's or an author's name.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/data/database.types";
import { createRepos } from "../src/lib/data/repos";
import { loadLayeredEnv } from "./load-layered-env";
import { parseAuthorSpec, planAuthors } from "./set-book-authors-spec";

const USAGE = "Usage: pnpm books:authors --spec <file> [--env <file>] [--skip-with-display-name] [--apply]";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const specFile = arg("--spec");
  const envFile = arg("--env") ?? ".env.prod";
  const apply = process.argv.includes("--apply");
  const skipWithDisplayName = process.argv.includes("--skip-with-display-name");
  if (!specFile) {
    console.error(USAGE);
    process.exit(1);
  }
  const parsed = parseAuthorSpec(JSON.parse(readFileSync(specFile, "utf8")));
  if (!parsed.ok) {
    console.error(`${specFile}:\n  ${parsed.errors.join("\n  ")}`);
    process.exit(1);
  }
  loadLayeredEnv(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
    process.exit(1);
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const repos = createRepos(db);
  const [books, members] = await Promise.all([repos.books.liveForAuthorMatch(), repos.members.list()]);
  const plan = planAuthors(parsed.entries, books, members, { skipWithDisplayName });

  console.log(`${apply ? "Setting" : "Checking (nothing will be written)"} ${plan.counts.entries} author name(s) in ${new URL(url).host}, against ${books.length} live book(s)`);
  let written = 0;
  let changedMeanwhile = 0;
  for (const outcome of plan.outcomes) {
    const at = `  #${outcome.index + 1} "${outcome.title}"`;
    switch (outcome.kind) {
      case "unmatched":
        console.log(`${at}: no live book with that title${parsed.entries[outcome.index].memberName ? " for that member" : ""}, skipped`);
        break;
      case "ambiguous":
        console.log(`${at}: ${outcome.why === "several_books" ? "more than one live book fits (add memberName)" : "two entries want different names for it"}, skipped`);
        break;
      case "has_display_name":
        console.log(`${at}: ${outcome.bookId} has a member with a display name, left alone`);
        break;
      case "has_pen_name":
        console.log(`${at}: ${outcome.bookId} already has a pen name, left alone`);
        break;
      case "set":
        if (!apply) {
          console.log(`${at}: ${outcome.bookId} would get its pen name`);
        } else if (await repos.books.setPenNameIfEmpty(outcome.bookId, outcome.name)) {
          written++;
          console.log(`${at}: ${outcome.bookId} pen name set`);
        } else {
          changedMeanwhile++;
          console.log(`${at}: ${outcome.bookId} got a pen name or was removed meanwhile, left alone`);
        }
        break;
    }
  }
  const c = plan.counts;
  console.log(
    `Entries ${c.entries}: matched ${c.matched} (already named ${c.alreadyHasPenName}, ${apply ? `set ${written}${changedMeanwhile ? `, changed meanwhile ${changedMeanwhile}` : ""}` : `would set ${c.wouldSet}`}), unmatched ${c.unmatched}, ambiguous ${c.ambiguous}.`,
  );
  console.log(`Of the ${c.wouldSet} to set: ${c.wouldAddAuthorLine} would gain an author line, ${c.sameAsDisplayName} already show that name, ${c.wouldReplaceDisplayName} would replace a different display name.${c.skippedDisplayName ? ` Skipped for a display name: ${c.skippedDisplayName}.` : ""}`);
  if (!apply && c.wouldSet > 0) console.log(`Run again with --apply to write ${c.wouldSet}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

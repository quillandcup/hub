/**
 * Imports Big Sister matches from a CSV export of the old tracking spreadsheet.
 *
 * The CSV is never committed (it names real people): keep it outside the repo.
 *
 * Columns: mentor, trial, trial_start (YYYY-MM-DD), note; optionally mentor_email and trial_email,
 * which win over names that can't be resolved. Whether a trial member converted is not imported:
 * the app derives it from membership history. Put a "why they didn't convert" in note.
 *
 * Usage:
 *   npx tsx scripts/import-mentorships.ts <csv-file> [env-file] [--apply]
 *
 * Without --apply it only reports what it would do (who each name resolved to, and every row it
 * can't import). Read that report, fix names or add emails to the CSV, then re-run with --apply.
 * Writes use the service role, so the audit log shows them as system changes.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { parseCsv, planImport, toImportRows } from "../lib/mentorship-import";
import { fetchTrialWindows, pickTrialWindow } from "../lib/trial-window";
import type { Member, MemberAlias, MemberEmailAlias } from "../lib/member-matching";
import { createRepos } from "@/lib/data/repos";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [csvPath, envFile = ".env.local"] = args.filter((a) => a !== "--apply");

if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-mentorships.ts <csv-file> [env-file] [--apply]");
  process.exit(1);
}

const loaded = config({ path: resolve(process.cwd(), envFile) });
if (loaded.error) {
  console.error(`Failed to load ${envFile}: ${loaded.error.message}`);
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}
const supabase = createClient(url, key);

async function fetchAll<T>(table: string, columns: string, eq?: [column: string, value: string]): Promise<T[]> {
  const BATCH_SIZE = 1000;
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const query = supabase.from(table).select(columns);
    const { data, error } = await (eq ? query.eq(eq[0], eq[1]) : query).range(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data && data.length > 0) {
      all.push(...(data as T[]));
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}

async function main() {
  const rows = toImportRows(parseCsv(readFileSync(resolve(csvPath), "utf8")));
  const [members, aliases, emailAliases, existing] = await Promise.all([
    fetchAll<Member>("members", "id, name, email"),
    fetchAll<MemberAlias>("member_name_aliases", "member_id, alias, source"),
    fetchAll<MemberEmailAlias>("member_email_aliases", "alias_email, canonical_email"),
    fetchAll<{ new_member_id: string }>("mentorships", "new_member_id", ["status", "matched"]),
  ]);

  const plan = planImport(rows, members, aliases, emailAliases, new Set(existing.map((e) => e.new_member_id)));

  console.log(`\n${plan.matches.length} match(es) ready:`);
  for (const m of plan.matches) {
    console.log(
      `  line ${m.line}: ${m.mentor.name} (${m.how.mentor}) -> ${m.trial.name} (${m.how.trial}), started ${m.startedOn}`
    );
  }
  if (plan.problems.length > 0) {
    console.log(`\n${plan.problems.length} to look at:`);
    for (const p of plan.problems) console.log(`  line ${p.line}: ${p.message}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write the matches above.");
    return;
  }

  // The real trial end for each match, from Stripe, so how long to wait before calling a trial
  // "not converted" isn't a guess. Left empty when Stripe has no matching trial.
  const windows = await fetchTrialWindows(
    createRepos(supabase),
    plan.matches.map((m) => m.trial)
  );

  const BATCH = 100;
  let written = 0;
  for (let i = 0; i < plan.matches.length; i += BATCH) {
    const batch = plan.matches.slice(i, i + BATCH).map((m) => ({
      mentor_member_id: m.mentor.id,
      new_member_id: m.trial.id,
      started_on: m.startedOn,
      kind: "trial",
      trial_ends_on: pickTrialWindow(windows.get(m.trial.id) ?? [], m.startedOn)?.end ?? null,
      outcome_note: m.note,
    }));
    const { error } = await supabase.from("mentorships").insert(batch);
    if (error) throw new Error(`insert failed after ${written} rows: ${error.message}`);
    written += batch.length;
  }
  console.log(`\nImported ${written} match(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

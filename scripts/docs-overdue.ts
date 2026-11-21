#!/usr/bin/env npx tsx
// Lists the living docs that are overdue for review, as markdown.
//
//   tsx scripts/docs-overdue.ts            (pnpm docs:overdue)
//   tsx scripts/docs-overdue.ts --today 2026-12-01
//
// Every living doc (everything in docs/ outside decisions/) carries, in its `> **Status:**` line,
// `**Last reviewed:** YYYY-MM-DD` (or `never`) and `Review: quarterly.` or `Review: yearly.`. A doc
// is overdue once the date plus its cadence is behind today. The weekly workflow
// .github/workflows/docs-overdue.yml turns the list into one GitHub issue. Nothing here fails
// because a doc is overdue: time passing must never turn CI red (tests/lib/docs-layout.test.ts
// checks only that the fields are well formed). Prints nothing when nothing is overdue.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clock } from "../lib/clock";
import { ORG_TIMEZONE } from "../lib/config";

export type Cadence = "quarterly" | "yearly";

export interface LivingDoc {
  path: string;
  /** An ISO date (YYYY-MM-DD), or the literal "never". */
  lastReviewed: string;
  cadence: Cadence;
}

export interface OverdueDoc extends LivingDoc {
  /** The day the review fell due; null when the doc was never reviewed. */
  dueOn: string | null;
  /** Whole days past the due date; null when the doc was never reviewed. */
  daysOverdue: number | null;
}

export const LIVING_FOLDERS = ["runbooks", "checklists", "architecture", "infrastructure", "trust", "product"];

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The date a review falls due: three months (quarterly) or a year (yearly) after the last one. */
export function dueDate(lastReviewed: string, cadence: Cadence): string {
  const start = new Date(parseIso(lastReviewed));
  const months = cadence === "quarterly" ? 3 : 12;
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDayOfTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDayOfTarget));
  return target.toISOString().slice(0, 10);
}

/**
 * The docs overdue on `today` (an ISO date): never reviewed, or due before today. A doc is still
 * on time on its due date itself. Never-reviewed docs come first, then the longest overdue.
 */
export function overdueDocs(docs: LivingDoc[], today: string): OverdueDoc[] {
  const todayMs = parseIso(today);
  const overdue: OverdueDoc[] = [];
  for (const doc of docs) {
    if (doc.lastReviewed === "never") {
      overdue.push({ ...doc, dueOn: null, daysOverdue: null });
      continue;
    }
    const dueOn = dueDate(doc.lastReviewed, doc.cadence);
    const days = Math.round((todayMs - parseIso(dueOn)) / DAY_MS);
    if (days > 0) overdue.push({ ...doc, dueOn, daysOverdue: days });
  }
  return overdue.sort((a, b) => (b.daysOverdue ?? Infinity) - (a.daysOverdue ?? Infinity) || a.path.localeCompare(b.path));
}

/** Reads the review fields out of a doc's status line; null when it has none of a living doc's. */
export function parseReview(text: string): { lastReviewed: string; cadence: Cadence } | null {
  const status = /^> \*\*Status:\*\* living\..*$/m.exec(text)?.[0];
  if (!status) return null;
  const reviewed = /\*\*Last reviewed:\*\* (\d{4}-\d{2}-\d{2}|never)/.exec(status)?.[1];
  const cadence = /Review: (quarterly|yearly)\./.exec(status)?.[1] as Cadence | undefined;
  return reviewed && cadence ? { lastReviewed: reviewed, cadence } : null;
}

/** The living docs under docs/, with their review fields. A doc that has none is skipped here; the layout test fails on it. */
export function readLivingDocs(docsDir: string): LivingDoc[] {
  const docs: LivingDoc[] = [];
  for (const folder of LIVING_FOLDERS) {
    for (const file of readdirSync(path.join(docsDir, folder)).filter((f) => f.endsWith(".md")).sort()) {
      const review = parseReview(readFileSync(path.join(docsDir, folder, file), "utf8"));
      if (review) docs.push({ path: `docs/${folder}/${file}`, ...review });
    }
  }
  return docs;
}

/** The markdown body of the "Docs overdue for review" issue. Empty when nothing is overdue. */
export function overdueMarkdown(overdue: OverdueDoc[], today: string): string {
  if (overdue.length === 0) return "";
  const rows = overdue.map(
    (d) => `| \`${d.path}\` | ${d.lastReviewed === "never" ? "never" : d.lastReviewed} | ${d.cadence} | ${d.daysOverdue ?? "never reviewed"} |`,
  );
  return [
    `Living docs overdue for review on ${today}:`,
    "",
    "| Doc | Last reviewed | Cadence | Days overdue |",
    "|---|---|---|---|",
    ...rows,
    "",
    "To clear an item, review the doc (fix whatever is wrong) and bump its `**Last reviewed:**` date.",
    "",
  ].join("\n");
}

/** Today's date in the org's zone, from the injectable clock. */
export function orgToday(nowMs: number = clock.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
}

function main(): void {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--today");
  const today = flag >= 0 ? args[flag + 1] : orgToday();
  const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
  process.stdout.write(overdueMarkdown(overdueDocs(readLivingDocs(docsDir), today), today));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

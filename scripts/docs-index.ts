#!/usr/bin/env npx tsx
// Keeps the index in each living docs folder's README.md: one line per doc, "[Title](FILE.md): first sentence".
//
//   tsx scripts/docs-index.ts             write the indexes   (pnpm docs:index; the pre-commit hook runs it)
//   tsx scripts/docs-index.ts --check     exit 1 if any index is out of date (tests/lib/docs-layout.test.ts runs the same check)
//
// The title is the doc's `# ` heading; the summary is the first sentence of the first paragraph after its Status line.
// The list sits between two marker comments in docs/<folder>/README.md; anything else in the README is yours. A folder
// without a README gets one (a title and the sentence in FOLDER_BLURBS, which you can edit afterwards).
// doctoc (pnpm docs:toc) builds a table of contents inside one file; it cannot list the other files of a folder, hence this.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVING_FOLDERS } from "./docs-overdue";

export const START_MARKER = "<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->";
export const END_MARKER = "<!-- END docs-index -->";

/** What a new folder README says under its title. Only used when the README does not exist yet. */
export const FOLDER_BLURBS: Record<string, string> = {
  runbooks: "Step-by-step procedures: setting up, inviting users, rotating secrets and the like.",
  checklists: "Lists to check the project against (Supabase, OpenSSF Best Practices, OSPS Baseline).",
  architecture: "How the data and the code are put together.",
  infrastructure: "Setup and configuration of the services we run on.",
  trust: "Security and privacy posture.",
  product: "How each feature works and why.",
  quality: "How quality is checked: the test suites, the guard tests and the exception lists that still hold cleanup work.",
};

const SUMMARY_LIMIT = 200;

export interface IndexEntry {
  file: string;
  title: string;
  summary: string;
}

/** The text of the first `# ` heading, or "" when the doc has none. */
export function titleOf(text: string): string {
  return /^# (.+)$/m.exec(text)?.[1].trim() ?? "";
}

/** Markdown links and emphasis reduced to their text, so a summary reads the same in any README. */
function plain(line: string): string {
  return line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * The first sentence of the first paragraph of prose after the Status line (or after the title when there is none).
 * Headings, quotes, tables, lists, code fences and comments are not prose and are skipped. "" when there is none.
 */
export function summaryOf(text: string): string {
  const lines = text.split("\n");
  const statusAt = lines.findIndex((l) => l.startsWith("> **Status:**"));
  let i = statusAt >= 0 ? statusAt + 1 : 1;
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim() === "" || /^(#|>|\||-|\*|\d+\.|<!--|<)/.test(line)) {
      // Skip the rest of a non-prose block, so a list item's wrapped lines are not read as a paragraph.
      if (!inFence && line.trim() !== "") {
        while (i + 1 < lines.length && lines[i + 1].trim() !== "") i++;
      }
      continue;
    }
    const paragraph: string[] = [];
    for (; i < lines.length && lines[i].trim() !== ""; i++) paragraph.push(lines[i]);
    const sentence = /^(.+?[.!?])(\s|$)/.exec(plain(paragraph.join(" ")))?.[1] ?? plain(paragraph.join(" "));
    const trimmed = sentence.replace(/[.]$/, "");
    return trimmed.length > SUMMARY_LIMIT ? `${trimmed.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : trimmed;
  }
  return "";
}

/** The entries for every doc in a folder except its README, in file order. */
export function readEntries(docsDir: string, folder: string): IndexEntry[] {
  return readdirSync(path.join(docsDir, folder))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(docsDir, folder, file), "utf8");
      return { file, title: titleOf(text), summary: summaryOf(text) };
    });
}

export function indexBlock(entries: IndexEntry[]): string {
  const lines = entries.map((e) => (e.summary ? `- [${e.title}](${e.file}): ${e.summary}` : `- [${e.title}](${e.file})`));
  return [START_MARKER, "", ...lines, "", END_MARKER].join("\n");
}

/** The README with its index block replaced (or a new README, when `existing` is null). */
export function updatedReadme(existing: string | null, folder: string, entries: IndexEntry[]): string {
  const block = indexBlock(entries);
  if (existing === null) {
    const name = folder.charAt(0).toUpperCase() + folder.slice(1);
    return `# ${name}\n\n${FOLDER_BLURBS[folder] ?? ""}\n\n${block}\n`;
  }
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start < 0 || end < start) throw new Error(`docs/${folder}/README.md has no docs-index markers (${START_MARKER} ... ${END_MARKER})`);
  return existing.slice(0, start) + block + existing.slice(end + END_MARKER.length);
}

/** Docs that have no title or no summary: the index can't describe them. */
export function problems(folder: string, entries: IndexEntry[]): string[] {
  return entries.flatMap((e) => [
    ...(e.title ? [] : [`docs/${folder}/${e.file} has no "# " title`]),
    ...(e.summary ? [] : [`docs/${folder}/${e.file} has no summary: put a plain sentence right after its Status line`]),
  ]);
}

/** Per folder, the README path and what it should contain; `current` is what it contains now (null: missing). */
export function expectedReadmes(docsDir: string, folders: string[] = LIVING_FOLDERS): { file: string; current: string | null; expected: string; problems: string[] }[] {
  return folders.map((folder) => {
    const file = path.join(docsDir, folder, "README.md");
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    const entries = readEntries(docsDir, folder);
    return { file, current, expected: updatedReadme(current, folder, entries), problems: problems(folder, entries) };
  });
}

function main(): void {
  const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
  const check = process.argv.includes("--check");
  const results = expectedReadmes(docsDir);
  let failed = false;
  for (const r of results) {
    for (const p of r.problems) {
      console.error(p);
      failed = true;
    }
    if (r.current === r.expected) continue;
    if (check) {
      console.error(`${path.relative(process.cwd(), r.file)} is out of date: run pnpm docs:index`);
      failed = true;
    } else {
      writeFileSync(r.file, r.expected);
      console.log(`updated ${path.relative(process.cwd(), r.file)}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

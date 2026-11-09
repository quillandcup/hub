import type { ChangelogEntry } from "@/lib/changelog/entries";

/**
 * The input side of the changelog drafter (`pnpm changelog:draft`): which merged pull requests could matter to a
 * changelog, and the prompt that asks an agent to group them into stories. It only reads what is already public (pull
 * request titles, bodies and file paths) and writes nothing to the changelog itself: the agent's output is a draft for a
 * person to review, see docs/CHANGELOG_PROCESS.md, "Drafting entries".
 */

export interface MergedPr {
  number: number;
  title: string;
  mergedAt: string;
  body: string;
  files: string[];
}

export type PrKind = "member-visible" | "engineering" | "skip";

const DOC_OR_TEST = /^(docs\/|tests\/|supabase\/tests\/|.*\.md$|\.claude\/)/;
const CHANGELOG_FILE = /^(lib\/changelog\/|public\/changelog\/|demo\/scenes\/changelog\/)/;
const MEMBER_SURFACE = /^(app\/\((member)\)\/|app\/\(public\)\/|components\/|emails\/|lib\/notifications\/)/;

/**
 * Which pull requests are worth showing the drafter. Changelog-only and docs/tests-only changes are skipped; a change
 * under a member-facing path is "member-visible", the rest is "engineering" (it may still be the lower-level detail of
 * a product story, so the drafter sees it).
 */
export function classifyPr(pr: Pick<MergedPr, "files">): PrKind {
  const files = pr.files;
  if (files.length === 0) return "engineering";
  if (files.every((f) => CHANGELOG_FILE.test(f) || DOC_OR_TEST.test(f))) return "skip";
  return files.some((f) => MEMBER_SURFACE.test(f)) ? "member-visible" : "engineering";
}

const BODY_LIMIT = 1500;

/** Pull request bodies can be long; the first part says what changed and why, which is all the grouping needs. */
export function trimBody(body: string, limit = BODY_LIMIT): string {
  const text = body.replace(/\r/g, "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

export interface DraftInput {
  since: string;
  prs: (MergedPr & { kind: Exclude<PrKind, "skip"> })[];
  existing: Pick<ChangelogEntry, "slug" | "date" | "audience" | "title">[];
}

export function buildDraftInput(since: string, prs: MergedPr[], entries: readonly ChangelogEntry[]): DraftInput {
  const kept: DraftInput["prs"] = [];
  for (const pr of [...prs].sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))) {
    const kind = classifyPr(pr);
    if (kind !== "skip") kept.push({ ...pr, kind });
  }
  const existing = entries
    .filter((e) => e.date >= since)
    .map(({ slug, date, audience, title }) => ({ slug, date, audience, title }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { since, prs: kept, existing };
}

/** The prompt for `claude -p`: the rules are read from the repo's own files, so they cannot drift from this prompt. */
export function buildDraftPrompt(input: DraftInput): string {
  const prs = input.prs
    .map((pr) => {
      const files = pr.files.slice(0, 12).join(", ") + (pr.files.length > 12 ? `, … (${pr.files.length} files)` : "");
      return `### #${pr.number} ${pr.title}\nmerged ${pr.mergedAt.slice(0, 10)} · ${pr.kind}\nfiles: ${files}\n\n${trimBody(pr.body)}`;
    })
    .join("\n\n");
  const existing = input.existing.map((e) => `- ${e.date} [${e.audience}] ${e.slug}: ${e.title}`).join("\n") || "(none)";

  return `You are drafting changelog entries for the Hedgie Hub from pull requests merged since ${input.since}.

First read .claude/rules/changelog-writing.md and docs/CHANGELOG_PROCESS.md, and follow them: one story per feature (not one per pull request), written for a busy member on her phone, benefit first, only claims you can see in the pull requests below. Do not invent behavior. If a pull request is a feature behind a flag, say so in a "Needs a human" note instead of drafting a product entry: its date is the day the flag goes on for everyone.

Entries that already exist in this window (do not duplicate; a later improvement to one of these is its own entry):
${existing}

For each story output a TypeScript object literal in the shape of ChangelogEntry (lib/changelog/entries.ts): slug, date (the day members could first use it, Eastern), audience, category, major only if it is a significant new capability, title, summary (one or two plain sentences, no markdown), body. After each one, list "Sources: #n, #m" and, for product entries, a one-line suggestion for what the demo scene should show. Then a final section "Skipped or needs a human" with the pull requests you left out and why (fix with no visible effect, flag still off, unclear).

Pull requests:

${prs}
`;
}

import { ORG_TIMEZONE } from "@/lib/config";
import type { ChangelogEntry } from "@/lib/changelog/entries";

/**
 * The input side of the changelog drafter (`pnpm changelog:draft`). It works in two small steps so a run stays cheap:
 * (1) a titles-only prompt asks a small model to group the merged pull requests into stories, (2) a second prompt gives
 * a larger model the trimmed bodies of only the member-visible stories to draft. It reads only public pull request text
 * and writes nothing to the changelog itself: the output is a draft for a person to review (docs/CHANGELOG_PROCESS.md,
 * "Drafting entries").
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
const CHANGELOG_FILE = /^(lib\/changelog\/|public\/changelog\/|demo\/scenes\/)/;
const ADMIN_PATH = /(^|\/)(admin|\(admin\))(\/|$)/;
const MEMBER_SURFACE = /^(app\/\(member\)\/|app\/\(public\)\/|components\/|emails\/|lib\/notifications\/)/;

/**
 * Which pull requests are worth showing the drafter. Changelog, demo, docs and tests-only changes are skipped; a change
 * under a member-facing path (admin screens do not count) is "member-visible", the rest is "engineering".
 */
export function classifyPr(pr: Pick<MergedPr, "files">): PrKind {
  const files = pr.files;
  if (files.length === 0) return "engineering";
  if (files.every((f) => CHANGELOG_FILE.test(f) || DOC_OR_TEST.test(f))) return "skip";
  return files.some((f) => MEMBER_SURFACE.test(f) && !ADMIN_PATH.test(f)) ? "member-visible" : "engineering";
}

/**
 * The flag keys a pull request names in its title or body, quoted as code (`chat_videos`, "chat_videos") so a plain word
 * such as hosting is not taken for the flag. A feature behind a flag is not a product update yet.
 */
export function flagsMentioned(pr: Pick<MergedPr, "title" | "body">, flagKeys: readonly string[]): string[] {
  const text = `${pr.title}\n${pr.body}`;
  return flagKeys.filter((key) => new RegExp(`[\`'"]${key}[\`'"]`).test(text));
}

/** The Eastern calendar day of an instant (a feature's date is an Eastern day, `dates-and-timezones.md`). */
export function easternDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** When a merged change reached production: the first production deployment created after the merge, or null. */
export function firstDeployAfter(mergedAt: string, deployTimes: readonly string[]): string | null {
  const merged = Date.parse(mergedAt);
  let best: string | null = null;
  for (const t of deployTimes) {
    if (Date.parse(t) >= merged && (best === null || Date.parse(t) < Date.parse(best))) best = t;
  }
  return best;
}

export interface DraftPr extends MergedPr {
  kind: Exclude<PrKind, "skip">;
  /** The Eastern day it was live in production, from GitHub deployments; null when not deployed yet. */
  liveOn: string | null;
}

export interface DraftInput {
  since: string;
  prs: DraftPr[];
  /** Pull requests left out because they name a flag that is not on for everyone, with the flag keys. */
  held: { number: number; title: string; flags: string[] }[];
  existing: Pick<ChangelogEntry, "slug" | "date" | "audience" | "title">[];
}

export interface DraftOptions {
  flagKeys: readonly string[];
  /** Flags that are on for everyone (a pull request that names only these is a normal change). */
  liveFlags: readonly string[];
  deployTimes: readonly string[];
}

export function buildDraftInput(since: string, prs: MergedPr[], entries: readonly ChangelogEntry[], options: DraftOptions): DraftInput {
  const kept: DraftPr[] = [];
  const held: DraftInput["held"] = [];
  for (const pr of [...prs].sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))) {
    const kind = classifyPr(pr);
    if (kind === "skip") continue;
    const flags = flagsMentioned(pr, options.flagKeys).filter((k) => !options.liveFlags.includes(k));
    if (flags.length > 0) {
      held.push({ number: pr.number, title: pr.title, flags });
      continue;
    }
    const deployed = firstDeployAfter(pr.mergedAt, options.deployTimes);
    kept.push({ ...pr, kind, liveOn: deployed ? easternDay(deployed) : null });
  }
  const existing = entries
    .filter((e) => e.date >= since)
    .map(({ slug, date, audience, title }) => ({ slug, date, audience, title }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { since, prs: kept, held, existing };
}

const BODY_LIMIT = 600;

/** Pull request bodies can be long; the start says what changed and why, which is all a draft needs. */
export function trimBody(body: string, limit = BODY_LIMIT): string {
  const text = body.replace(/\r/g, "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

const FILES_SHOWN = 3;

/** Step 1, titles only: group the pull requests into stories. Answers with JSON so step 2 can fetch only what it needs. */
export function buildGroupPrompt(input: DraftInput): string {
  const lines = input.prs
    .map((pr) => `#${pr.number} [${pr.kind}] ${pr.title} (${pr.files.slice(0, FILES_SHOWN).join(", ")}${pr.files.length > FILES_SHOWN ? ", …" : ""})`)
    .join("\n");
  const existing = input.existing.map((e) => `- ${e.slug}: ${e.title}`).join("\n") || "(none)";
  return `Group these merged pull requests of a members' community app into changelog stories: one story per feature or fix members would notice, several pull requests per story when they build one thing. Pull requests that change nothing a member can see (refactors, admin-only screens, tooling) go in "engineering" or "skip".

Stories that already exist (a pull request that only continues one of these goes in "skip"):
${existing}

Answer with JSON only, no prose: {"stories":[{"slug":"kebab-case","title":"…","prs":[123,124]}],"engineering":[123],"skip":[125]}

Pull requests:
${lines}
`;
}

export interface Story {
  slug: string;
  title: string;
  prs: number[];
}

export interface Grouping {
  stories: Story[];
  engineering: number[];
  skip: number[];
}

/** Reads step 1's answer, tolerating text around the JSON; unknown pull request numbers are dropped. */
export function parseGrouping(text: string, known: ReadonlySet<number>): Grouping {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The grouping answer has no JSON object");
  const raw = JSON.parse(match[0]) as Partial<Grouping>;
  const only = (nums: unknown): number[] => (Array.isArray(nums) ? nums.filter((n): n is number => typeof n === "number" && known.has(n)) : []);
  const stories = (Array.isArray(raw.stories) ? raw.stories : [])
    .map((s) => ({ slug: String(s?.slug ?? ""), title: String(s?.title ?? ""), prs: only(s?.prs) }))
    .filter((s) => s.slug && s.prs.length > 0);
  return { stories, engineering: only(raw.engineering), skip: only(raw.skip) };
}

/** Step 2: draft the stories, with the writing rules in the prompt (so the model needs no tools) and only these bodies. */
export function buildStoryPrompt(stories: Story[], input: DraftInput, rules: string): string {
  const byNumber = new Map(input.prs.map((pr) => [pr.number, pr]));
  const blocks = stories.map((story) => {
    const prs = story.prs
      .map((n) => byNumber.get(n))
      .filter((pr): pr is DraftPr => pr !== undefined)
      .map((pr) => `#${pr.number} ${pr.title} (live ${pr.liveOn ?? "not deployed yet"})\n${trimBody(pr.body)}`)
      .join("\n\n");
    return `## ${story.slug}: ${story.title}\n${prs}`;
  });
  return `Draft one changelog entry per story below for the Hedgie Hub, following these rules exactly.

${rules}

For each story output a TypeScript object literal in the shape of ChangelogEntry: slug, date (the earliest "live" day of its pull requests, YYYY-MM-DD), audience "product", category, major only for a significant new capability, title, summary (one or two plain sentences, no markdown), body (markdown). Say only what the pull requests state; if a claim is unclear, leave it out and add a "Check:" line after the entry. After each entry add "Sources: #n, #m" and a one-line suggestion for what a demo scene should show.

Stories:

${blocks.join("\n\n")}
`;
}

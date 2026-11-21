import { ORG_TIMEZONE } from "@/lib/config";

/**
 * The Finisher record (docs/product/FINISHERS.md): the milestones a member can claim, the three uses they may consent to, and the
 * rules for reading a member's answer. Plain module (no server imports) so client components can use the wording.
 *
 * Two milestones are stored (`member_milestones`); the third, published, is derived from `member_books` and never stored.
 */

export const MILESTONE_KINDS = ["the_end", "publish_ready"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_STATUSES = ["proposed", "confirmed", "declined"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_SOURCES = ["member", "project_stage", "course", "staff"] as const;
export type MilestoneSource = (typeof MILESTONE_SOURCES)[number];

/**
 * The stamp for milestone 2. Its name is still undecided (FINAL DRAFT, POLISHED, THE LAST WORD: docs/product/WRITER_TITLES.md,
 * "Still open"), so it is this one string; the stored value stays `publish_ready`.
 */
export const PUBLISH_READY_STAMP = "FINAL DRAFT";

/** The stamp each milestone shows, and the title it earns (docs/product/WRITER_TITLES.md). */
export const MILESTONE_LABELS: Record<MilestoneKind, string> = {
  the_end: "THE END",
  publish_ready: PUBLISH_READY_STAMP,
};
export const MILESTONE_TITLES: Record<MilestoneKind, string> = {
  the_end: "Finisher",
  publish_ready: "Author",
};

/** The same milestone as the member would say it, for the card that asks them. */
export const MILESTONE_CLAIMS: Record<MilestoneKind, string> = {
  the_end: "You wrote THE END",
  publish_ready: "You revised it until it was ready to publish",
};

/** The third milestone, derived from the Bookshelf and never stored (docs/product/FINISHERS.md). */
export const PUBLISHED_TITLE = "Published Author";
export const PUBLISHED_CLAIM = "It is published";

/** What the member says when they add a milestone themselves ("I wrote THE END"), per kind. */
export const MILESTONE_SELF_ADD: Record<MilestoneKind, { button: string; confirmLabel: string }> = {
  the_end: { button: "I wrote THE END", confirmLabel: "Add it" },
  publish_ready: { button: "My manuscript is publish-ready", confirmLabel: "Add it" },
};

/** Where a proposal came from, in words a member understands. */
export const MILESTONE_SOURCE_NOTES: Record<MilestoneSource, string> = {
  member: "You added this.",
  project_stage: "Suggested from a project you moved forward.",
  course: "Suggested because you finished a course.",
  staff: "Suggested by the Quill & Cup team.",
};

/** The uses a member can agree to, one at a time. All are off until they tick them. */
export const MILESTONE_CONSENTS = [
  { key: "consent_profile", label: "My writer profile", hint: "If you turn on a public profile, show this on it." },
  { key: "consent_homepage", label: "The Quill & Cup homepage", hint: "Count me, and show my story, among the writers who finished." },
  { key: "consent_testimonial", label: "Telling other writers", hint: "Quote my words when we tell other writers what is possible." },
] as const;
export type ConsentKey = (typeof MILESTONE_CONSENTS)[number]["key"];
export type Consents = Record<ConsentKey, boolean>;

export const NO_CONSENT: Consents = { consent_profile: false, consent_homepage: false, consent_testimonial: false };

export const MAX_STORY_LENGTH = 2000;

/** What a member sends when they answer a proposal. */
export type MilestoneAnswerInput = {
  answer: "confirm" | "decline";
  achievedOn?: string | null;
  storyBefore?: string | null;
  storyAfter?: string | null;
  consents?: Partial<Consents>;
};

/** A confirmed answer: what the repository stores when the member says "yes, this is me" (or adds the milestone themselves). */
export type ConfirmedMilestoneAnswer = { status: "confirmed"; achievedOn: string | null; storyBefore: string | null; storyAfter: string | null } & Consents;

/** What the repository stores for an answer (declined drops any consent: a consent only exists on a confirmed row). */
export type MilestoneAnswer = ConfirmedMilestoneAnswer | { status: "declined" };

/** Today's date (YYYY-MM-DD) for the org, not for the server's zone. */
export function orgToday(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Reads a member's answer. A confirmed answer keeps the optional date and stories (blank means none) and each consent as
 * ticked (anything not ticked is off); a decline keeps nothing. `{ error }` is a sentence for the member.
 */
export function parseMilestoneAnswer(input: MilestoneAnswerInput, nowMs: number): MilestoneAnswer | { error: string } {
  if (input.answer === "decline") return { status: "declined" };
  if (input.answer !== "confirm") return { error: "Choose whether this is you." };

  const achievedOn = clean(input.achievedOn);
  if (achievedOn !== null) {
    if (!realDate(achievedOn)) return { error: "That date doesn't look right. Use the date picker, or leave it blank." };
    if (achievedOn > orgToday(nowMs)) return { error: "That date is still ahead of us. Pick today or earlier, or leave it blank." };
  }
  const storyBefore = clean(input.storyBefore);
  const storyAfter = clean(input.storyAfter);
  for (const story of [storyBefore, storyAfter]) {
    if (story !== null && story.length > MAX_STORY_LENGTH) return { error: `Please keep each story under ${MAX_STORY_LENGTH} characters.` };
  }
  const consents = Object.fromEntries(MILESTONE_CONSENTS.map(({ key }) => [key, input.consents?.[key] === true])) as Consents;
  return { status: "confirmed", achievedOn, storyBefore, storyAfter, ...consents };
}

/**
 * Reads what a member sends when they add a milestone themselves: the same answer as confirming a proposal (so the same date
 * and story rules), always a confirmation. `{ error }` is a sentence for the member.
 */
export function parseMilestoneSelfAdd(input: Omit<MilestoneAnswerInput, "answer"> & { kind: unknown }, nowMs: number): { kind: MilestoneKind; answer: ConfirmedMilestoneAnswer } | { error: string } {
  if (!isMilestoneKind(input.kind)) return { error: "Choose which milestone you are adding." };
  const answer = parseMilestoneAnswer({ ...input, answer: "confirm" }, nowMs);
  if ("error" in answer) return answer;
  if (answer.status !== "confirmed") return { error: "Choose whether this is you." };
  return { kind: input.kind, answer };
}

export function isMilestoneKind(value: unknown): value is MilestoneKind {
  return typeof value === "string" && (MILESTONE_KINDS as readonly string[]).includes(value);
}

/** What the Activity Log says; the dates and stories a member wrote never go in a sentence. */
export function milestoneLabel(kind: string): string {
  return isMilestoneKind(kind) ? MILESTONE_LABELS[kind] : "milestone";
}

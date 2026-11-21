import { ORG_TIMEZONE } from "@/lib/config";
import { VISIBILITIES, type Visibility } from "@/lib/writing-visibility";

/**
 * The Finisher record (docs/product/FINISHERS.md): the milestones a member can claim, the one consent they may give for marketing, and the
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
  publish_ready: "It is ready to publish",
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

/**
 * The one consent a milestone carries: "Share my story to inspire other writers" (stored as `consent_testimonial`). It is for
 * marketing: the Finishers section of the website and the testimonials we share. It is off until the member ticks it, only
 * means something on a confirmed milestone with a story, and is never a condition of saving (docs/product/FINISHERS.md).
 */
export const SHARE_STORY_DEFAULT = false;
export const SHARE_STORY_LABEL = "Share my story to inspire other writers.";
export const SHARE_STORY_NOTE =
  "Your story could be the thing that gets someone staring at a blank page to start. If you tick this, we may feature it on the Quill & Cup website and in what we share about our writers. We'll only use what you've written here, and you can change your mind any time.";
export const SHARE_STORY_TIP = "For marketing: the Finishers section of our website, and testimonials we share.";

/** What a member is told right after they confirm a milestone, before anything else. */
export const MILESTONE_CELEBRATION: Record<MilestoneKind, string> = {
  the_end: "You wrote THE END. We're so proud of you.",
  publish_ready: "Your manuscript is publish-ready. What a lot of work, and you did it.",
};

/** How a milestone reads in the strip on a profile: the title it earns, and what the writer did. */
export const MILESTONE_SHOWN: Record<MilestoneKind, string> = {
  the_end: "Wrote THE END",
  publish_ready: "Manuscript ready to publish",
};

/** A calendar date a member picked ("2026-05-01"), as words. It is a day, not an instant, so no zone is applied. */
export function milestoneDateWords(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The levels a click on a milestone's lock, house or globe cycles through: private, community and, only when writer profiles
 * are open to the member (the `writer_profiles` flag), public. A milestone that is not confirmed has no control at all.
 */
export function milestoneLevels(webAvailable: boolean): Visibility[] {
  return webAvailable ? [...VISIBILITIES] : ["private", "community"];
}

const LEVEL_NOW: Record<Visibility, string> = {
  private: "Only you can see this milestone.",
  community: "Other members can see this milestone on your profile.",
  public: "Anyone on the internet can see this milestone on your writer profile once your writer profile is on. Other members can see it too.",
};
const LEVEL_CLICK: Record<Visibility, string> = {
  private: "Click to keep it to yourself.",
  community: "Click to show it to other members.",
  public: "Click to show it to everyone on the internet, on your writer profile.",
};

/** The tooltip on a milestone's lock, house or globe: who sees it now, and where a click goes. A story shares the milestone's level. */
export function describeMilestoneLevel(visibility: Visibility, next: Visibility): string {
  return `${LEVEL_NOW[visibility]} The story you wrote goes with it. ${LEVEL_CLICK[next]}`;
}

/**
 * The note under a milestone at the globe, so the globe never promises more than will happen: writer profiles are not open to
 * this member, or the profile is off. Null when the level needs no note.
 */
export function milestoneWebNote(visibility: Visibility, page: { available: boolean; on: boolean }): string | null {
  if (visibility !== "public") return null;
  if (!page.available) return "Other members can see it. It is not on the web, because writer profiles are not open to you yet.";
  if (!page.on) return "Other members already see this. It goes on the web once your writer profile is on.";
  return null;
}

/** Whether a milestone has a story the member wrote (so the share tick makes sense). */
export function hasStory(m: { storyBefore: string | null; storyAfter: string | null }): boolean {
  return Boolean(m.storyBefore?.trim() || m.storyAfter?.trim());
}

export const MAX_STORY_LENGTH = 2000;

/** What a member sends when they answer a proposal. */
export type MilestoneAnswerInput = {
  answer: "confirm" | "decline";
  achievedOn?: string | null;
  storyBefore?: string | null;
  storyAfter?: string | null;
  /** The share tick. It only counts when a story is written. */
  shareStory?: boolean;
};

/** A confirmed answer: what the repository stores when the member says "yes, this is me" (or adds the milestone themselves). */
export type ConfirmedMilestoneAnswer = { status: "confirmed"; achievedOn: string | null; storyBefore: string | null; storyAfter: string | null; consent_testimonial: boolean };

/** What the repository stores for an answer (declined drops the consent and the level: both only exist on a confirmed row). */
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
 * Reads a member's answer. A confirmed answer keeps the optional date and stories (blank means none) and the share tick (off
 * unless ticked, and off when no story was written); a decline keeps nothing. `{ error }` is a sentence for the member.
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
  const consent_testimonial = input.shareStory === true && (storyBefore !== null || storyAfter !== null);
  return { status: "confirmed", achievedOn, storyBefore, storyAfter, consent_testimonial };
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

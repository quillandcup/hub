/**
 * Hedgie Care's value sets (docs/HEDGIE_CARE.md): the reasons, channels and endings an engagement can have, their labels and
 * the guards for them. No imports, so the repository, the tracking plan and the page can all take them without pulling in
 * the config or the date helpers. The same lists are the `CHECK` constraints of `care_engagements` (the migration): change
 * them in both places.
 */

/** Why she is reaching out. Not "check-in" alone: that name belongs to the prickle mood check-ins. */
export const CARE_REASONS = ["introduction", "welcome", "check_in", "writing_check_in", "encouragement", "other"] as const;
export type CareReason = (typeof CARE_REASONS)[number];

export const CARE_REASON_LABELS: Record<CareReason, string> = {
  introduction: "An introduction",
  welcome: "A welcome",
  check_in: "A check-in",
  writing_check_in: "A writing check-in",
  encouragement: "Encouragement",
  other: "Something else",
};

/** Where it happens. */
export const CARE_CHANNELS = ["slack_dm", "prickle", "email", "other"] as const;
export type CareChannel = (typeof CARE_CHANNELS)[number];

export const CARE_CHANNEL_LABELS: Record<CareChannel, string> = {
  slack_dm: "Slack DM",
  prickle: "In a prickle",
  email: "Email",
  other: "Somewhere else",
};

/** How an engagement ended: her own read of it. `renewed` is set only by renewing (the next period continues it). */
export const CARE_ENDED_HOW = [
  "back_in_community",
  "friendly_contact",
  "no_reply",
  "asked_not_to_contact",
  "handed_off",
  "ran_its_course",
  "renewed",
] as const;
export type CareEndedHow = (typeof CARE_ENDED_HOW)[number];

export const CARE_ENDED_HOW_LABELS: Record<CareEndedHow, string> = {
  back_in_community: "Back in the community",
  friendly_contact: "Staying in friendly contact",
  no_reply: "No reply",
  asked_not_to_contact: "Asked not to be contacted",
  handed_off: "Handed to someone else",
  ran_its_course: "Ran its course",
  renewed: "Renewed",
};

/** What she may pick when closing: everything but `renewed`, which only Renew sets. */
export const CARE_CLOSE_OPTIONS: readonly CareEndedHow[] = CARE_ENDED_HOW.filter((how) => how !== "renewed");

/** The database's length limits on the two free-text fields (CHECK constraints in 20270626000000). */
export const CARE_NOTES_MAX = 1000;
export const CARE_NEXT_STEP_MAX = 280;

/** Who wrote a message she is logging. */
export const MESSAGE_DIRECTIONS = ["member", "staff"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export function isCareReason(value: unknown): value is CareReason {
  return typeof value === "string" && (CARE_REASONS as readonly string[]).includes(value);
}
export function isCareChannel(value: unknown): value is CareChannel {
  return typeof value === "string" && (CARE_CHANNELS as readonly string[]).includes(value);
}
export function isCareEndedHow(value: unknown): value is CareEndedHow {
  return typeof value === "string" && (CARE_ENDED_HOW as readonly string[]).includes(value);
}
/** Whether she may close with this (every way but `renewed`). */
export function isCloseOption(value: unknown): value is CareEndedHow {
  return isCareEndedHow(value) && value !== "renewed";
}
/**
 * Whether a string looks like an engagement id (`care_` and 12 base58 characters). Engagements are Tier 2: their ids are
 * never in a URL or link, only in our own client's calls to our own server actions, so this is a sanity check on the call,
 * not the URL validation `isId` (lib/ids.ts) does for ids people can see.
 */
export function isCareId(value: unknown): value is string {
  return typeof value === "string" && /^care_[1-9A-HJ-NP-Za-km-z]{12}$/.test(value);
}
export function isMessageDirection(value: unknown): value is MessageDirection {
  return typeof value === "string" && (MESSAGE_DIRECTIONS as readonly string[]).includes(value);
}


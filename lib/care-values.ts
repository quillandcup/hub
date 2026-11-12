/**
 * Hedgie Care's value sets (docs/HEDGIE_CARE.md): the reasons and endings a care plan can have, their labels and
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

/** One line under each reason in the start form: when to pick it. */
export const CARE_REASON_HELP: Record<CareReason, string> = {
  introduction: "You are saying hello to someone you have not spoken with yet.",
  welcome: "A new member, or one coming back, and you are welcoming them in.",
  check_in: "A general how-are-you, with nothing specific in mind.",
  writing_check_in: "You are asking how their writing is going.",
  encouragement: "They are having a hard time or doing well, and you want to cheer them on.",
  other: "None of these fit.",
};

/** How an engagement ended: her own read of it. `renewed` is set only by renewing (the next period continues it). */
export const CARE_ENDED_HOW = ["back_in_community", "no_reply", "handed_off", "ran_its_course", "renewed"] as const;
export type CareEndedHow = (typeof CARE_ENDED_HOW)[number];

export const CARE_ENDED_HOW_LABELS: Record<CareEndedHow, string> = {
  back_in_community: "Back in the community",
  no_reply: "No reply",
  handed_off: "Handed to someone else",
  ran_its_course: "Ran its course",
  renewed: "Renewed",
};

/**
 * One line under each ending in the close dialog: what it means, so two people closing the same way mean the same thing.
 * Read top to bottom, the first that fits is the one to pick. If the conversation is still alive and she has a concrete
 * plan, she renews instead of closing.
 */
export const CARE_ENDED_HOW_HELP: Record<CareEndedHow, string> = {
  handed_off:
    "The need was not yours (billing, Big Sister, a host, an admin). Say to whom in the note. Also pick this if a member asks you to stop, and tell an admin in the note.",
  no_reply: "You wrote and they never answered, even after a follow-up. Never pick this if they replied even once.",
  back_in_community: "They replied, and the numbers show they took part again after your first message.",
  ran_its_course:
    "The exchange is done, or they are content but busy (not in a writing season, busy at home, no sign they might leave) and nothing is pending. Consider setting a later check-in date.",
  renewed: "Set by Renew.",
};

/** The order the close dialog lists the endings in (first match wins), without `renewed`, which only Renew sets. */
export const CARE_CLOSE_OPTIONS: readonly CareEndedHow[] = ["handed_off", "no_reply", "back_in_community", "ran_its_course"];

/** The database's length limits on the two free-text fields (CHECK constraints in 20270626000000). */
export const CARE_NOTES_MAX = 1000;
export const CARE_NEXT_STEP_MAX = 280;

/** Who wrote a message she is logging. */
export const MESSAGE_DIRECTIONS = ["member", "staff"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export function isCareReason(value: unknown): value is CareReason {
  return typeof value === "string" && (CARE_REASONS as readonly string[]).includes(value);
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


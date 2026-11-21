/**
 * Which Block Kit controls the Hub chat draws as working controls, and for what: only the ones in Billie Bot's check-in and
 * check-out DMs (src/lib/prickle-checkin-dms.ts), recognised by their action ids. Everything else an app puts in a message stays
 * display only, with "Open in Slack" for the rest, because a control the Hub draws must do something it understands.
 * Client safe (no server imports): the parser, the card and the endpoint all read this one list.
 */

const CHECKIN_ANSWER = "prickle_checkin_answer";
export const DM_SUBMIT_ACTION = "prickle_submit";
export const DM_DISMISS_ACTION = "prickle_dismiss";
export const DM_QUICK_LOG_ACTION = "writing_quick_log";

/** An action id of one of our DMs: a check-in question (a select, or a scale button `prickle_checkin_answer:<point>`), Submit, Skip, or the quick log. */
export function isDmActionId(actionId: unknown): actionId is string {
  return (
    typeof actionId === "string" &&
    (actionId === CHECKIN_ANSWER ||
      actionId.startsWith(`${CHECKIN_ANSWER}:`) ||
      actionId === DM_SUBMIT_ACTION ||
      actionId === DM_DISMISS_ACTION ||
      actionId === DM_QUICK_LOG_ACTION)
  );
}

/** What the Hub sends when a control is used: where it was, which control, and what was chosen or typed. Ids here are never trusted (the endpoint re-checks them against the stored message). */
export interface DmControlPress {
  channelId: string;
  messageId: string;
  blockId: string;
  actionId: string;
  /** A button's value, or a number typed into a number input. */
  value?: string;
  /** The option picked in a select; absent when it was cleared. */
  selectedValue?: string;
}

/** Bounds for strings the Hub takes from the browser. */
export const MAX_DM_CONTROL_STRING = 300;

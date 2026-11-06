// The "#event" tag, kept apart from lib/calendar-events.ts (which pulls in server-only code) so a client component can use it.

/** The tag that, in a Google Calendar event's description, shows the event in Events: "#event". */
const EVENT_TAG = /(^|[\s>(])#event\b/gi;

/** Whether the description carries the #event tag. "#events" and "#eventful" don't count. */
export function hasEventTag(description: string | null | undefined): boolean {
  if (!description) return false;
  EVENT_TAG.lastIndex = 0;
  return EVENT_TAG.test(description);
}


/**
 * Markdown that is already converted (a prickle's description) with the #event tag taken out. It must not go
 * through the HTML conversion again: that would escape the markdown (`\*with\*`, `\[link\]`).
 */
export function stripEventTag(markdown: string | null | undefined): string | null {
  const plain = markdown?.trim();
  if (!plain) return null;
  const cleaned = plain
    .replace(EVENT_TAG, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || null;
}

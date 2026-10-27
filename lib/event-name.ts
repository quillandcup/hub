// What members read as an event's name. The title is stored without its guest speaker or host (their own
// fields), but "A Way to Make Money with Brayden Bonnesen" is the name the community knows it by, and "Progress
// Prickle" alone says nothing when there are thirty a week: wherever a member sees the event it is the title and,
// when there is one, "with" its speakers, or else its host.

import { hostShortName } from "@/lib/formatters";

/** The title with who is with it: "Query Letters" + speakers "Sam Example" -> "Query Letters with Sam Example"; with only a host, "Progress Prickle with Jenn P". */
export function eventDisplayName(title: string, speakers: string | null | undefined, host?: string | null): string {
  const who = speakers?.trim() || (host?.trim() ? hostShortName(host) : "");
  if (!who || title.toLowerCase().includes(who.toLowerCase())) return title;
  return `${title} with ${who}`;
}

// What members read as an event's name. An event stands on a prickle, whose title is the calendar's ("Quill & Cup
// [Craft] Prickle: Query Letters"), so the name drops the organization's label, the "[Category]" and "Prickle:"
// (`cleanEventTitle`). Who is with it stays: "A Way to Make Money with Sam Example" is the name the community
// knows it by (the guest is what brings people in), and "Progress Prickle" alone says nothing when there are
// thirty a week: wherever a member sees the event it is the title and, when there is one, "with" its speakers,
// or else its host. Admin edit forms show the prickle's real title instead, so saving never stores a cleaned one.

import { cleanEventTitle } from "@/lib/events-agenda";
import { hostShortName } from "@/lib/formatters";

/** The cleaned title with who is with it: "Query Letters" + speakers "Sam Example" -> "Query Letters with Sam Example"; with only a host, "Progress Prickle with Jenn P". A title that already names them is left as it is. */
export function eventDisplayName(title: string, speakers: string | null | undefined, host?: string | null): string {
  const name = cleanEventTitle(title);
  const who = speakers?.trim() || (host?.trim() ? hostShortName(host) : "");
  if (!who || name.toLowerCase().includes(who.toLowerCase())) return name;
  return `${name} with ${who}`;
}

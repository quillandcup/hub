// What members read as an event's name. The title is stored without its guest speaker (the speakers are their
// own field), but "A Way to Make Money with Brayden Bonnesen" is the name the community knows it by, so wherever
// a member sees the event it is the title and, when there are speakers, "with" them.

/** The title with its speakers: "Query Letters" + "Sam Example" -> "Query Letters with Sam Example". */
export function eventDisplayName(title: string, speakers: string | null | undefined): string {
  const who = speakers?.trim();
  if (!who || title.toLowerCase().includes(who.toLowerCase())) return title;
  return `${title} with ${who}`;
}

// Where an event is, as members read it. A calendar item's location is often just the video call link
// ("https://us06web.zoom.us/j/8710...?pwd=..."), which is noise on a card and carries the meeting password. This
// shows "Online (Zoom)" instead, and keeps the link for a "Join" control. A location that is a place stays as typed.

export interface LocationDisplay {
  /** What to show: the place as typed, or "Online (Zoom)" for a link. */
  text: string;
  /** The link, when the location is one; null for a place. */
  href: string | null;
  /** A short name for a join control: "Join on Zoom", "Join online". */
  joinLabel: string | null;
}

const KNOWN_HOSTS: [RegExp, string][] = [
  [/(^|\.)zoom\.(us|com)$/i, "Zoom"],
  [/(^|\.)meet\.google\.com$/i, "Google Meet"],
  [/(^|\.)teams\.microsoft\.com$/i, "Microsoft Teams"],
];

/** The location as members should see it, or null when there is none. */
export function locationDisplay(location: string | null | undefined): LocationDisplay | null {
  const value = location?.trim();
  if (!value) return null;

  if (!/^https?:\/\/\S+$/i.test(value)) return { text: value, href: null, joinLabel: null };

  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return { text: value, href: null, joinLabel: null };
  }
  const known = KNOWN_HOSTS.find(([pattern]) => pattern.test(host))?.[1];
  return {
    text: known ? `Online (${known})` : "Online",
    href: value,
    joinLabel: known ? `Join on ${known}` : "Join online",
  };
}

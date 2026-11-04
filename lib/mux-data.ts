/**
 * Mux Data for the course player (docs/MUX_CONFIG.md, "Mux Data"): what the browser sends about a view.
 * Pure and client-safe; the server side that decides who gets it is lib/mux-data.server.ts.
 */

/** Consent facts the lesson page hands the player so the browser can decide, and follow the banner, on its own. */
export interface MuxDataConsent {
  /** The viewer must accept the banner first (EU, EEA, UK or unknown location, in production). */
  needsConsent: boolean;
  /** "Leave me out of statistics" is on for this account. */
  optedOut: boolean;
}

/**
 * The metadata for one view: the lesson's title (course content, not a person) and the player's name. Mux fills in the
 * video id from the playback id. There is deliberately no `viewer_user_id` (a member's id, email or name never goes to
 * Mux; each view is anonymous) and no custom dimension that could hold a person; cookies are off
 * (`disableCookies` on the extension), so a returning viewer isn't recognized either.
 */
export function muxDataMetadata(lessonTitle: string): { video_title: string; player_name: string } {
  return { video_title: lessonTitle, player_name: "Hub lesson player" };
}

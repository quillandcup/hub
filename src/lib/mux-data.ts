/**
 * Mux Data for the course player (docs/infrastructure/MUX_CONFIG.md, "Mux Data"): what the browser sends about a view.
 * Pure and client-safe; the server side that decides who gets it is src/lib/mux-data.server.ts.
 */

/** Consent facts the lesson page hands the player so the browser can decide, and follow the banner, on its own. */
export interface MuxDataConsent {
  /** The viewer must accept the banner first (EU, EEA, UK or unknown location, in production). */
  needsConsent: boolean;
  /** "Leave me out of statistics" is on for this account. */
  optedOut: boolean;
}

/** Where a player is shown; each reports under its own player name, so Mux's dashboard can filter views by it. */
export type PlayerSurface = "course" | "builder" | "chat";

const PLAYER_NAMES: Record<PlayerSurface, string> = {
  course: "Hub Course player",
  builder: "Hub Course Builder player",
  chat: "Hub Chat player",
};

/**
 * The metadata for one view: the lesson's title (course content, not a person) and the player's name. Mux fills in the
 * video id from the playback id. There is deliberately no `viewer_user_id` (a member's id, email or name never goes to
 * Mux; each view is anonymous) and no custom dimension that could hold a person; cookies are off
 * (`disableCookies` on the extension), so a returning viewer isn't recognized either.
 */
export function muxDataMetadata(lessonTitle: string, surface: PlayerSurface = "course"): { video_title: string; player_name: string } {
  return { video_title: lessonTitle, player_name: PLAYER_NAMES[surface] };
}

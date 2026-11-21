/**
 * Names for `data-track="..."`: what impressions and click-through are counted by, so one name
 * should mean one control (or one kind of control that appears in many places, like a sidebar
 * item). Format `feature-control` in lower-case kebab-case: `onair-join-zoom`, `nav-my-prickles`.
 * Name a feature's main controls when it ships (the ones that answer "is this used?"); skip the
 * incidental ones. tests/lib/track-names.test.ts checks every literal name in the source.
 */

export const TRACK_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A path as a name part: `/my-prickles/all` -> `my-prickles-all`, `/` -> `home`. */
export function trackSlug(path: string): string {
  const slug = path
    .split(/[?#]/, 1)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "home";
}

/** The name of a navigation link to `path`: `nav-<path>`. */
export const navTrackName = (path: string): string => `nav-${trackSlug(path)}`;

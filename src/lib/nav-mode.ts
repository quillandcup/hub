/**
 * How the member sidebar behaves: pinned open, pinned closed (an icon rail), or auto-hide (a rail that
 * opens over the page while hovered or focused). One setting per member, kept on `user_profiles.nav_mode`.
 */
export const NAV_MODES = ["open", "closed", "auto"] as const;
export type NavMode = (typeof NAV_MODES)[number];

export const isNavMode = (value: unknown): value is NavMode => typeof value === "string" && (NAV_MODES as readonly string[]).includes(value);

/** Chat has its own channel list beside the sidebar, so until a member chooses, it rests as an auto-hide rail there. */
export const isChatPath = (pathname: string) => pathname === "/chat" || pathname.startsWith("/chat/");

/** The mode in effect: the member's choice, else the page's default. */
export function resolveNavMode(stored: NavMode | null | undefined, pathname: string): NavMode {
  return stored ?? (isChatPath(pathname) ? "auto" : "open");
}

/** The mode the toggle button moves to next: open, then auto-hide, then closed, then open again. */
export const nextNavMode = (mode: NavMode): NavMode => NAV_MODES[(NAV_MODES.indexOf(mode) + 2) % NAV_MODES.length];

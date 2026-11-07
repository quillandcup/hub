/**
 * Browser errors raised by the visitor's own browser extensions or in-app browsers, never by our code: the
 * extension's `runtime.sendMessage` is rejected inside the page with no frame of ours in the stack (HUB-Y, DuckDuckGo
 * on iOS). Kept narrow on purpose: only this exact message is dropped, so a real error of ours is never hidden.
 */
export const IGNORED_BROWSER_ERRORS: RegExp[] = [/^Invalid call to runtime\.sendMessage\(\)\. Tab not found\.?$/];

/**
 * Web Push is an outbound server request to a browser-supplied URL. Only provider-owned
 * destinations are allowed, including for subscriptions saved before this validation existed.
 * Keep this security policy here rather than accepting arbitrary HTTPS URLs or redirects.
 * Providers: Chrome FCM, Firefox Autopush, Safari APNs, and Edge WNS.
 * https://developer.chrome.com/blog/push-notifications-on-the-open-web
 * https://mozilla-services.github.io/autopush-rs/
 * https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
 * https://learn.microsoft.com/en-us/windows-365/link/connection-endpoints
 */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return false;
    return url.hostname === "fcm.googleapis.com" ||
      url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname.endsWith(".push.apple.com") ||
      url.hostname.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

// Service worker for Browser notifications (Web Push). Registered from the settings page when a
// member turns notifications on for a device (components/BrowserNotificationsToggle.tsx). The payload
// shape is PushPayload in lib/channels/web-push.ts. Not cached or precached: it only shows
// notifications and opens the Hub when one is clicked.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // Every push must show something: Chrome posts its own generic "updated in the background"
  // notification when a worker doesn't, and may revoke the permission for repeat offenders.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  if (!payload || typeof payload !== "object") payload = { body: String(payload) };
  payload.title = payload.title || "Notification";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Replacing a notification with the same tag should still alert.
      renotify: Boolean(payload.tag),
      requireInteraction: Boolean(payload.requireInteraction),
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever a Hub path (hubPath in lib/channels/in-app.ts); resolve against our own origin.
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(openTarget(target));
});

// Reuse an open Hub tab when we can drive it, otherwise open a new one. A window this worker can't
// drive fails in different ways (WindowClient.navigate() rejects for a tab it doesn't control, focus()
// throws for a tab that is already closed but still listed), and either used to leave the click doing
// nothing at all. So try each Hub tab in turn, best first: already on the target, then the focused
// one, then a visible one, then the rest. Focus first, while the click's user activation is fresh
// (Chrome on macOS doesn't always raise the window after an async navigate).
//
// WindowClient.url is only the tab's last full page load: the Hub navigates in place (pushState), so a
// tab that reads as already on the target may have moved on. That ranks it first but never lets us skip
// navigating it.
async function openTarget(target) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const rank = (w) => (w.url === target.href ? 0 : w.focused ? 1 : w.visibilityState === "visible" ? 2 : 3);
  const hubTabs = windows
    .filter((w) => new URL(w.url).origin === self.location.origin && new URL(w.url).pathname !== "/sw.js")
    .sort((a, b) => rank(a) - rank(b));
  console.log("[sw] notification click", { target: target.href, hubTabs: hubTabs.map((w) => w.url) });
  for (const tab of hubTabs) {
    try {
      if ("focus" in tab) await tab.focus();
      const navigated = "navigate" in tab ? await tab.navigate(target.href) : null;
      if (navigated) {
        // The tab is already where it should be; a focus failure now mustn't send us on to another tab.
        try {
          await navigated.focus();
        } catch {
          // Ignore.
        }
        return;
      }
    } catch (error) {
      console.warn("[sw] couldn't reuse an open tab", tab.url, error);
    }
  }
  await self.clients.openWindow(target.href);
}

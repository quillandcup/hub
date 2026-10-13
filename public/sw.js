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

// Reuse an open Hub tab when we can drive it, otherwise open a new one. WindowClient.navigate()
// rejects for a tab this worker doesn't control (opened before it activated) and focus() can reject
// too, which used to leave the click doing nothing at all. Focus goes first, while the click's user
// activation is fresh (Chrome on macOS doesn't always raise the window after an async navigate), and a
// tab already on the target is just focused rather than navigated to where it is.
async function openTarget(target) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
  console.log("[sw] notification click", { target: target.href, openTabs: windows.length, reusing: open ? open.url : null });
  if (open) {
    try {
      if ("focus" in open) await open.focus();
      if (open.url === target.href) return;
      const navigated = "navigate" in open ? await open.navigate(target.href) : null;
      if (navigated) {
        await navigated.focus();
        return;
      }
    } catch (error) {
      console.warn("[sw] couldn't reuse the open tab", error);
      // Fall through to a new window.
    }
  }
  await self.clients.openWindow(target.href);
}

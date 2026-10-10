// Service worker for Browser notifications (Web Push). Registered from the settings page when a
// member turns notifications on for a device (components/BrowserNotificationsToggle.tsx). The payload
// shape is PushPayload in lib/channels/web-push.ts. Not cached or precached: it only shows
// notifications and opens the Hub when one is clicked.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
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

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(target.href);
      } else {
        await self.clients.openWindow(target.href);
      }
    })
  );
});

// Service worker for Browser notifications (Web Push). Registered from the settings page when a
// member turns notifications on for a device (components/BrowserNotificationsToggle.tsx). The payload
// shape is PushPayload in lib/channels/web-push.ts. No app content is cached or precached: it shows
// notifications, opens the Hub, and keeps a small local history for click diagnostics.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const DIAGNOSTICS_VERSION = "click-diagnostics-v1";
const DIAGNOSTICS_CACHE = "hub-push-diagnostics";
const DIAGNOSTICS_URL = new URL("/__push_diagnostics__", self.location.origin).href;
let diagnosticWrites = Promise.resolve();
let diagnosticStorageFailed = false;

// Local, bounded, and content-free. Never delay focus/navigation on a storage operation.
function recordDiagnostic(stage, notificationId, error) {
  const entry = { at: new Date().toISOString(), stage, notificationId, ...(error ? { error: error.name || "Error" } : {}) };
  diagnosticWrites = diagnosticWrites.then(async () => {
    const cache = await self.caches.open(DIAGNOSTICS_CACHE);
    const previous = await cache.match(DIAGNOSTICS_URL);
    const entries = previous ? await previous.json() : [];
    await cache.put(DIAGNOSTICS_URL, new Response(JSON.stringify([...entries, entry].slice(-30))));
  }).catch(() => { diagnosticStorageFailed = true; }); // Storage denial must never prevent opening.
  return diagnosticWrites;
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PUSH_DIAGNOSTICS" || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      await diagnosticWrites;
      if (diagnosticStorageFailed) throw new Error("Diagnostic storage failed");
      const cache = await self.caches.open(DIAGNOSTICS_CACHE);
      const response = await cache.match(DIAGNOSTICS_URL);
      event.ports[0].postMessage({ version: DIAGNOSTICS_VERSION, entries: response ? await response.json() : [] });
    } catch {
      event.ports[0].postMessage({ error: "This browser cannot store notification diagnostics." });
    }
  })());
});

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
  const notificationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Replacing a notification with the same tag should still alert.
      renotify: Boolean(payload.tag),
      requireInteraction: Boolean(payload.requireInteraction),
      data: { url: payload.url, notificationId },
    }).then(() => recordDiagnostic("shown", notificationId))
  );
});

self.addEventListener("notificationclick", (event) => {
  const notificationId = event.notification.data?.notificationId || "older-notification";
  const received = recordDiagnostic("click_received", notificationId);
  event.waitUntil(received);
  event.waitUntil(handleClick(event, notificationId).catch((error) => recordDiagnostic("open_failed", notificationId, error)));
});

async function handleClick(event, notificationId) {
  event.notification.close();
  // A Hub path, or an https link the server allowed (notificationUrl in lib/channels/in-app.ts: the
  // Slack workspace only); resolve against our own origin.
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) {
    if (target.protocol === "https:") {
      await self.clients.openWindow(target.href);
      await recordDiagnostic("external_open_requested", notificationId);
    }
    return;
  }

  await openTarget(target, notificationId);
}

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
async function openTarget(target, notificationId) {
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
        } catch (error) {
          await recordDiagnostic("focus_failed", notificationId, error);
        }
        await recordDiagnostic("tab_navigated", notificationId);
        return;
      }
    } catch (error) {
      console.warn("[sw] couldn't reuse an open tab", tab.url, error);
      // Queue the write; keep the next focus attempt on the click's activation path.
      recordDiagnostic("tab_reuse_failed", notificationId, error);
    }
  }
  await self.clients.openWindow(target.href);
  await recordDiagnostic("window_open_requested", notificationId);
}

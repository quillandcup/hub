// Service worker for Browser notifications (Web Push). Registered from the settings page when a
// member turns notifications on for a device (components/BrowserNotificationsToggle.tsx). The payload
// shape is PushPayload in lib/channels/web-push.ts. No app content is cached or precached: it shows
// notifications, opens the Hub, and keeps a small local history for click diagnostics.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const DIAGNOSTICS_VERSION = "click-diagnostics-v4";
const DIAGNOSTICS_CACHE = "hub-push-diagnostics";
const DIAGNOSTICS_URL = new URL("/__push_diagnostics__", self.location.origin).href;
let diagnosticWrites = Promise.resolve();
let diagnosticStorageFailed = false;

function diagnosticPath(value) {
  try {
    return new URL(value, self.location.origin).pathname;
  } catch {
    return "[invalid URL]";
  }
}

// Keep the useful browser explanation, excluding URL credentials, queries, fragments, and stacks.
function diagnosticMessage(error) {
  return String(error?.message ?? error)
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, (url) => diagnosticPath(url))
    .replace(/[?#][^\s"'<>]+/g, "[redacted]")
    .slice(0, 500);
}

// Local and bounded. Never delay focus/navigation on a storage operation.
function recordDiagnostic(stage, notificationId, { error, target, operation, style, tagged } = {}) {
  const entry = {
    at: new Date().toISOString(), stage, notificationId, version: DIAGNOSTICS_VERSION, operation,
    ...(target ? { pathname: diagnosticPath(target) } : {}),
    ...(style ? { style } : {}),
    ...(tagged ? { tagged: true } : {}),
    ...(error ? { error: error.name || "Error", errorMessage: diagnosticMessage(error) } : {}),
  };
  diagnosticWrites = diagnosticWrites.then(async () => {
    const cache = await self.caches.open(DIAGNOSTICS_CACHE);
    const previous = await cache.match(DIAGNOSTICS_URL);
    const entries = previous ? await previous.json() : [];
    await cache.put(DIAGNOSTICS_URL, new Response(JSON.stringify([...entries, entry].slice(-30))));
  }).catch(() => { diagnosticStorageFailed = true; }); // Storage denial must never prevent opening.
  return diagnosticWrites;
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "PUSH_ALERT_COMPARISON" && event.ports?.[0]) {
    const style = event.data.style;
    if (style !== "standard" && style !== "persistent" && style !== "tagged") return;
    const notificationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const target = "/admin/notifications";
    event.waitUntil(
      self.registration.showNotification(`[Test] ${style} browser alert`, {
        body: "Click to test whether the browser delivers this notification to the Hub.",
        // Check-ins also set a tag and renotify. Repeating this test replaces the first alert.
        ...(style === "tagged" ? { tag: "prickle_checkin:comparison", renotify: true } : {}),
        requireInteraction: style !== "standard",
        data: { url: target, notificationId },
      })
        .then(() => recordDiagnostic("shown", notificationId, { target, operation: "show_notification", style, tagged: style === "tagged" }))
        .then(() => event.ports[0].postMessage({ notificationId }))
        .catch((error) => event.ports[0].postMessage({ error: diagnosticMessage(error) }))
    );
    return;
  }
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
    }).then(() => recordDiagnostic("shown", notificationId, {
      target: payload.url || "/", operation: "show_notification", style: payload.requireInteraction ? "persistent" : "standard",
      tagged: Boolean(payload.tag),
    }))
  );
});

self.addEventListener("notificationclick", (event) => {
  const notificationId = event.notification.data?.notificationId || "older-notification";
  const context = { target: event.notification.data?.url || "/", operation: "receive_click" };
  const received = recordDiagnostic("click_received", notificationId, context);
  event.waitUntil(received);
  event.waitUntil(handleClick(event, notificationId, context).catch((error) => recordDiagnostic("open_failed", notificationId, { ...context, error })));
});

async function handleClick(event, notificationId, context) {
  context.operation = "close_notification";
  event.notification.close();
  // A Hub path, or an https link the server allowed (notificationUrl in lib/channels/in-app.ts: the
  // Slack workspace only); resolve against our own origin.
  context.operation = "resolve_target";
  const target = new URL(context.target, self.location.origin);
  if (target.origin !== self.location.origin) {
    if (target.protocol === "https:") {
      context.operation = "open_window";
      await self.clients.openWindow(target.href);
      await recordDiagnostic("external_open_requested", notificationId, context);
    }
    return;
  }

  await openTarget(target, notificationId, context);
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
async function openTarget(target, notificationId, context) {
  context.operation = "list_windows";
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const rank = (w) => (w.url === target.href ? 0 : w.focused ? 1 : w.visibilityState === "visible" ? 2 : 3);
  const hubTabs = windows
    .filter((w) => new URL(w.url).origin === self.location.origin && new URL(w.url).pathname !== "/sw.js")
    .sort((a, b) => rank(a) - rank(b));
  console.log("[sw] notification click", { target: target.href, hubTabs: hubTabs.map((w) => w.url) });
  for (const tab of hubTabs) {
    try {
      context.operation = "focus_tab";
      if ("focus" in tab) await tab.focus();
      context.operation = "navigate_tab";
      const navigated = "navigate" in tab ? await tab.navigate(target.href) : null;
      if (navigated) {
        // The tab is already where it should be; a focus failure now mustn't send us on to another tab.
        try {
          context.operation = "focus_tab";
          await navigated.focus();
        } catch (error) {
          await recordDiagnostic("focus_failed", notificationId, { ...context, error });
        }
        await recordDiagnostic("tab_navigated", notificationId, { ...context, operation: "navigate_tab" });
        return;
      }
    } catch (error) {
      console.warn("[sw] couldn't reuse an open tab", tab.url, error);
      // Queue the write; keep the next focus attempt on the click's activation path.
      recordDiagnostic("tab_reuse_failed", notificationId, { ...context, error });
    }
  }
  context.operation = "open_window";
  await self.clients.openWindow(target.href);
  await recordDiagnostic("window_open_requested", notificationId, context);
}

"use client";

import { listPushDevices, pausePushSubscription, resumePushSubscription } from "@/app/(member)/settings/notificationActions";

const OPT_IN_PREFIX = "hub.browserPush.";

// Serialize enroll/resume/pause in this tab, including React's repeated mount effects.
let pendingChange: Promise<unknown> = Promise.resolve();
export function withBrowserPushLock<T>(change: () => Promise<T>): Promise<T> {
  const result = pendingChange.then(change, change);
  pendingChange = result.catch(() => {});
  return result;
}

/** Local intent is per account. The server independently checks that this consent is still valid. */
export function rememberBrowserPush(memberId: string, endpoint: string): void {
  localStorage.setItem(`${OPT_IN_PREFIX}${memberId}`, endpoint);
}

export function forgetBrowserPush(endpoint: string): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(OPT_IN_PREFIX) && localStorage.getItem(key) === endpoint) localStorage.removeItem(key);
  }
}

async function unsubscribeLocally(registration: ServiceWorkerRegistration, subscription: PushSubscription | null) {
  const results = await Promise.allSettled([
    subscription && subscription.unsubscribe().then((removed) => {
      if (!removed) throw new Error("Browser refused to unsubscribe");
    }),
    registration.getNotifications?.().then((notifications) => notifications.forEach((n) => n.close())),
  ]);
  for (const result of results) {
    if (result.status === "rejected") console.error("[notifications] Clearing this browser's push failed", result.reason);
  }
}

/** Pause server delivery and unsubscribe locally, preserving opt-in for the next sign-in. */
export async function pauseBrowserPush(): Promise<void> {
  return withBrowserPushLock(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration) return;
    const subscription = await registration.pushManager?.getSubscription();
    try {
      if (subscription) {
        const result = await pausePushSubscription(subscription.endpoint);
        if ("error" in result) throw new Error(result.error);
        rememberBrowserPush(result.memberId, subscription.endpoint);
      }
    } finally {
      await unsubscribeLocally(registration, subscription ?? null);
    }
  });
}

/** Restore this account's own opt-in, or stop another account's local delivery. Never prompts. */
export async function syncBrowserPush(memberId: string, publicKey: string | null, signal?: AbortSignal): Promise<void> {
  return withBrowserPushLock(async () => {
    if (signal?.aborted) return;
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration?.pushManager) return;
    let subscription = await registration.pushManager.getSubscription();
    const devices = await listPushDevices(subscription?.endpoint ?? null);
    if (signal?.aborted) return;
    const own = devices.find((d) => d.isThisDevice);
    if (subscription && own && !own.paused) {
      rememberBrowserPush(memberId, subscription.endpoint);
      return;
    }
    const previousEndpoint = localStorage.getItem(`${OPT_IN_PREFIX}${memberId}`);
    if (subscription && !own) {
      await unsubscribeLocally(registration, subscription);
      subscription = null;
    }
    if (!previousEndpoint || !publicKey || Notification.permission !== "granted") return;
    const resumed = subscription ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
    try {
      const result = await resumePushSubscription(previousEndpoint, resumed.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      if ("error" in result) throw new Error(result.error);
      rememberBrowserPush(memberId, resumed.endpoint);
      window.dispatchEvent(new Event("browser-push-resumed"));
    } catch (error) {
      await unsubscribeLocally(registration, resumed);
      throw error;
    }
  });
}

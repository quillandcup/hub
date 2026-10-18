"use client";

import { listPushDevices, removePushSubscription } from "@/app/(member)/settings/notificationActions";

/** Stop local delivery even if the server is unreachable, and vice versa. Never unregister the worker. */
export async function clearBrowserPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return;
  const subscription = await registration.pushManager?.getSubscription();
  const results = await Promise.allSettled([
    subscription && removePushSubscription(subscription.endpoint).then((result) => {
      if ("error" in result) throw new Error(result.error);
    }),
    subscription && subscription.unsubscribe().then((removed) => {
      if (!removed) throw new Error("Browser refused to unsubscribe");
    }),
    registration.getNotifications?.().then((notifications) => notifications.forEach((n) => n.close())),
  ]);
  for (const result of results) {
    if (result.status === "rejected") console.error("[notifications] Clearing this browser's push failed", result.reason);
  }
}

/** Account changes need a new explicit opt-in, not an automatic transfer from the last member. */
export async function clearUnownedBrowserPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  const devices = await listPushDevices(subscription.endpoint);
  if (!devices.some((d) => d.isThisDevice)) await clearBrowserPush();
}

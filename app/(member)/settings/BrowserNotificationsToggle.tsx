"use client";

import { useEffect, useState } from "react";
import { InstallSteps, isIosBrowserTab } from "@/components/InstallAppPrompt";
import {
  listPushDevices,
  removePushDevice,
  removePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
  type PushDeviceRow,
} from "./notificationActions";

type DeviceState = "checking" | "unsupported" | "blocked" | "off" | "on";

const SERVICE_WORKER_PATH = "/sw.js";

/** The VAPID public key as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function supportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Turns Browser notifications on or off for the device you're on. A subscription belongs to one
 * browser profile, so every device is turned on separately; the "Browser" switches in the grid
 * below then decide which kinds go there. Needs notification permission, a service worker
 * (public/sw.js) and the server remembering the subscription (savePushSubscription).
 */
export function BrowserNotificationsToggle({ publicKey, readOnly }: { publicKey: string; readOnly: boolean }) {
  const [state, setState] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [iosTab, setIosTab] = useState(false);

  /** Reload the member's devices, marking this browser's by its subscription endpoint. */
  const refreshDevices = async () => {
    const registration = supportsPush() ? await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH) : undefined;
    const subscription = await registration?.pushManager.getSubscription();
    setDevices(await listPushDevices(subscription?.endpoint ?? null));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: DeviceState = "off";
      if (!supportsPush()) next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else if (Notification.permission === "granted") {
        const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
        if (await registration?.pushManager.getSubscription()) next = "on";
      }
      if (cancelled) return;
      setIosTab(isIosBrowserTab());
      setState(next);
      await refreshDevices();
    })().catch(() => !cancelled && setState("off"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await sendTestPushNotification();
    if ("error" in result) setError(result.error);
    else {
      setNotice(
        "Sent. It should show up on your devices in a moment. Nothing? Check your system notification settings (Focus mode, the browser's alert style) and restart your browser."
      );
    }
    setBusy(false);
  };

  const removeDevice = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await removePushDevice(id);
    if ("error" in result) setError(result.error);
    else await refreshDevices();
    setBusy(false);
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const result = await savePushSubscription(
        subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } },
        navigator.userAgent
      );
      if ("error" in result) {
        await subscription.unsubscribe();
        setError(result.error);
        return;
      }
      setState("on");
      await refreshDevices();
    } catch (e) {
      console.error("[notifications] Turning on browser notifications failed", e);
      setError("Couldn't turn on notifications for this device. Check your browser's settings and try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await removePushSubscription(subscription.endpoint);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        await subscription.unsubscribe();
      }
      setState("off");
      await refreshDevices();
    } catch (e) {
      console.error("[notifications] Turning off browser notifications failed", e);
      setError("Couldn't turn off notifications for this device. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") return null;

  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
      <div className="font-medium text-slate-900 dark:text-slate-100">Browser notifications on this device</div>
      {state === "unsupported" &&
        (iosTab ? (
          <div className="mt-1 text-slate-500 dark:text-slate-400">
            <InstallSteps />
          </div>
        ) : (
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            This browser can&apos;t show notifications from the Hub. Try a recent version of Chrome, Edge, Firefox or
            Safari.
          </p>
        ))}
      {state === "blocked" && (
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then come back
          and turn them on.
        </p>
      )}
      {(state === "off" || state === "on") && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-slate-500 dark:text-slate-400">
            {state === "on"
              ? "On. This device gets the kinds you've turned Browser on for below, even when the Hub isn't open."
              : "Off. Turn on to get the kinds you choose below as notifications on this device, even when the Hub isn't open. Each device you use is turned on separately."}
          </p>
          <button
            type="button"
            disabled={readOnly || busy}
            aria-busy={busy}
            onClick={state === "on" ? disable : enable}
            className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {state === "on" ? "Turn off for this device" : "Turn on for this device"}
          </button>
        </div>
      )}
      {devices.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-slate-700 dark:text-slate-300">Your devices</div>
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={sendTest}
              className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Send a test notification
            </button>
          </div>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-slate-900 dark:text-slate-100">{device.label}</span>
                  {device.isThisDevice && <span className="ml-2 text-xs text-slate-500">this device</span>}
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Added {new Date(device.addedAt).toLocaleDateString()}
                    {device.lastSentAt && ` · last notified ${new Date(device.lastSentAt).toLocaleDateString()}`}
                  </div>
                </div>
                {!device.isThisDevice && (
                  <button
                    type="button"
                    disabled={readOnly || busy}
                    aria-label={`Remove ${device.label}`}
                    onClick={() => removeDevice(device.id)}
                    className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-2 text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

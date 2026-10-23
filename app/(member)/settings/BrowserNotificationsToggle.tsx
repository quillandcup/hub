"use client";

import { rememberBrowserPush, forgetBrowserPush, withBrowserPushLock } from "@/lib/browser-push";
import { useEffect, useRef, useState } from "react";
import { InstallSteps, isIosBrowserTab } from "@/components/InstallAppPrompt";
import {
  listPushDevices,
  removePushDevice,
  removePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
  type PushDeviceRow,
} from "./notificationActions";
import { formatOrgDate } from "@/lib/formatters";

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
  const lastEndpoint = useRef<string | null>(null);
  const [state, setState] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [iosTab, setIosTab] = useState(false);

  /** Reload the member's devices, marking this browser's by its subscription endpoint. */
  const refreshDevices = async () => {
    try {
      const registration = supportsPush() ? await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH) : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) lastEndpoint.current = subscription.endpoint;
      setDevices(await listPushDevices(subscription?.endpoint ?? null));
    } catch {
      setError("Couldn't load your notification devices. Please try again.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = supportsPush();
      const registration = supported ? await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH) : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      const devices = await listPushDevices(subscription?.endpoint ?? null);
      if (cancelled) return;
      lastEndpoint.current = subscription?.endpoint ?? null;
      let next: DeviceState = "off";
      if (!supported) next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else if (Notification.permission === "granted" && subscription && devices.some((d) => d.isThisDevice && !d.paused)) next = "on";
      setDevices(devices);
      setIosTab(isIosBrowserTab());
      setState(next);
    })().catch(() => {
      if (!cancelled) {
        setState("off");
        setError("Couldn't check notifications for this device. Please try again.");
      }
    });
    const onResume = () => {
      cancelled = true; // The initial lookup may predate the resumed subscription.
      setState("on");
      void refreshDevices();
    };
    window.addEventListener("browser-push-resumed", onResume);
    return () => {
      cancelled = true;
      window.removeEventListener("browser-push-resumed", onResume);
    };
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
      await withBrowserPushLock(async () => {
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
        rememberBrowserPush(result.memberId, subscription.endpoint);
        lastEndpoint.current = subscription.endpoint;
        setState("on");
        await refreshDevices();
      });
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
      await withBrowserPushLock(async () => {
        const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
        const subscription = await registration?.pushManager.getSubscription();
        const endpoint = subscription?.endpoint ?? lastEndpoint.current;
        if (endpoint) {
          const result = await removePushSubscription(endpoint);
          if ("error" in result) {
            setError(result.error);
            return;
          }
          forgetBrowserPush(endpoint);
          lastEndpoint.current = null;
          await subscription?.unsubscribe();
        }
        setState("off");
        await refreshDevices();
      });
    } catch (e) {
      console.error("[notifications] Turning off browser notifications failed", e);
      setError("Couldn't turn off notifications for this device. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") return null;

  const thisDevice = devices.find((d) => d.isThisDevice);
  const otherDevices = devices.filter((d) => !d.isThisDevice);
  const canToggle = state === "off" || state === "on";
  const buttonClass =
    "rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <div id="browser-notifications" className="font-medium text-slate-900 dark:text-slate-100">Browser notifications</div>
        {(canToggle || otherDevices.length > 0) && devices.length > 0 && (
          <button type="button" data-track="settings-browser-notifications-test" disabled={readOnly || busy} onClick={sendTest} className={buttonClass}>
            Send a test notification
          </button>
        )}
      </div>
      <p className="text-slate-500 dark:text-slate-400">You get these even when the Hub isn&apos;t open.</p>
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
      {(canToggle || otherDevices.length > 0) && (
        <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <div className="font-medium text-slate-700 dark:text-slate-300">Your devices</div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {canToggle && (
              <li className="flex items-center gap-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="text-slate-900 dark:text-slate-100">{thisDevice?.label ?? "This browser"}</span>
                  <span className="ml-2 text-xs text-slate-500">this device</span>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {thisDevice
                      ? `Added ${formatOrgDate(thisDevice.addedAt)}${thisDevice.lastSentAt ? ` · last notified ${formatOrgDate(thisDevice.lastSentAt)}` : ""}`
                      : "Off"}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={readOnly || busy}
                  aria-busy={busy}
                  data-track={state === "on" ? "settings-browser-notifications-off" : "settings-browser-notifications-on"}
                  onClick={state === "on" ? disable : enable}
                  className={buttonClass}
                >
                  {state === "on" ? "Turn off for this device" : "Turn on for this device"}
                </button>
              </li>
            )}
            {otherDevices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="text-slate-900 dark:text-slate-100">{device.label}</span>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {device.paused ? "Paused while signed out · " : ""}Added {formatOrgDate(device.addedAt)}
                    {device.lastSentAt && ` · last notified ${formatOrgDate(device.lastSentAt)}`}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={readOnly || busy}
                  aria-label={`Remove ${device.label}`}
                  data-track="settings-browser-notifications-remove-device"
                  onClick={() => removeDevice(device.id)}
                  className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Remove
                </button>
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

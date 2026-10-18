export type PushDiagnostics = {
  version: string;
  entries: { at: string; stage: string; notificationId: string; error?: string }[];
};

/** Update the existing registration without changing permission, consent, or subscription. */
export async function readPushDiagnostics(): Promise<PushDiagnostics> {
  if (!("serviceWorker" in navigator)) throw new Error("This browser does not support browser notifications.");
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) throw new Error("Enable Browser notifications for this device in Settings → Notifications first.");
  await registration.update();
  const updating = registration.installing ?? registration.waiting;
  if (updating && updating.state !== "activated") {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        updating.removeEventListener("statechange", changed);
        if (error) reject(error);
        else resolve();
      };
      const changed = () => {
        if (updating.state === "activated") finish();
        if (updating.state === "redundant") finish(new Error("The notification worker update failed. Reload and try again."));
      };
      const timer = setTimeout(() => finish(new Error("The notification worker is still updating. Reload and try again.")), 5000);
      updating.addEventListener("statechange", changed);
      changed();
    });
  }
  const worker = registration.active;
  if (!worker) throw new Error("The notification worker is not active. Reload and try again.");
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (result?: PushDiagnostics, error?: Error) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(undefined, new Error("The notification worker did not respond. Reload this page and try again.")), 5000);
    channel.port1.onmessage = ({ data }) => {
      if (data.error) finish(undefined, new Error(data.error));
      else finish(data);
    };
    try {
      worker.postMessage({ type: "PUSH_DIAGNOSTICS" }, [channel.port2]);
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

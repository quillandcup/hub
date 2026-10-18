// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPushDiagnostics, sendBrowserAlertComparison } from "@/lib/browser-push-diagnostics";

const result = { version: "click-diagnostics-v1", entries: [] };
function setup(reply: unknown = result) {
  const port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  const port2 = { close: vi.fn() };
  vi.stubGlobal("MessageChannel", class { port1 = port1; port2 = port2; });
  const postMessage = vi.fn(() => { if (reply !== undefined) queueMicrotask(() => port1.onmessage?.({ data: reply })); });
  const registration = { update: vi.fn().mockResolvedValue(undefined), active: { postMessage }, installing: null as any, waiting: null };
  const getRegistration = vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
  return { port1, port2, registration, getRegistration, postMessage };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("readPushDiagnostics", () => {
  it("sends a local comparison through the active worker without changing subscription", async () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    const { postMessage, port2, registration } = setup({ notificationId: "local-test" });
    expect(await sendBrowserAlertComparison("standard")).toBe("local-test");
    expect(registration.update).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: "PUSH_ALERT_COMPARISON", style: "standard" }, [port2]);
  });

  it("refuses a local comparison when permission is not already granted", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    const { postMessage } = setup();
    await expect(sendBrowserAlertComparison("persistent")).rejects.toThrow("not allowed");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("checks for an updated worker and requests diagnostics from the active worker", async () => {
    const { registration, postMessage, getRegistration, port1, port2 } = setup();
    expect(await readPushDiagnostics()).toEqual(result);
    expect(getRegistration).toHaveBeenCalledWith("/sw.js");
    expect(registration.update).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: "PUSH_DIAGNOSTICS" }, [port2]);
    expect(port1.close).toHaveBeenCalledOnce();
    expect(port2.close).toHaveBeenCalledOnce();
  });

  it("waits until the updated worker is activated before messaging it", async () => {
    const { registration, postMessage } = setup();
    const updating = Object.assign(new EventTarget(), { state: "installing" });
    registration.installing = updating;
    const pending = readPushDiagnostics();
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    expect(postMessage).not.toHaveBeenCalled();
    updating.state = "activated";
    updating.dispatchEvent(new Event("statechange"));
    expect(await pending).toEqual(result);
  });

  it("reports a failed worker update", async () => {
    const { registration } = setup();
    registration.installing = Object.assign(new EventTarget(), { state: "redundant" });
    await expect(readPushDiagnostics()).rejects.toThrow("worker update failed");
  });

  it("reports when storage cannot retain events instead of presenting an empty history", async () => {
    setup({ error: "Storage unavailable" });
    await expect(readPushDiagnostics()).rejects.toThrow("Storage unavailable");
  });

  it("bounds waiting for an old worker without a message handler", async () => {
    vi.useFakeTimers();
    const { postMessage, port1 } = setup();
    postMessage.mockImplementation(() => {});
    const pending = expect(readPushDiagnostics()).rejects.toThrow("did not respond");
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(port1.close).toHaveBeenCalledOnce();
  });

  it("bounds waiting for an update that never activates", async () => {
    vi.useFakeTimers();
    const { registration } = setup();
    registration.installing = Object.assign(new EventTarget(), { state: "installing" });
    const pending = expect(readPushDiagnostics()).rejects.toThrow("still updating");
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  });

  it("reports missing support or registration without asking for notification permission", async () => {
    await expect(readPushDiagnostics()).rejects.toThrow("does not support");
    const { getRegistration } = setup();
    getRegistration.mockResolvedValue(undefined);
    await expect(readPushDiagnostics()).rejects.toThrow("Enable Browser notifications");
  });

  it("closes the ports when posting the message fails", async () => {
    const { postMessage, port1 } = setup();
    postMessage.mockImplementation(() => { throw new Error("Worker stopped"); });
    await expect(readPushDiagnostics()).rejects.toThrow("Worker stopped");
    expect(port1.close).toHaveBeenCalledOnce();
  });
});

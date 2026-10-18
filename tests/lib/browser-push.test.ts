// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const listPushDevices = vi.hoisted(() => vi.fn());
const removePushSubscription = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/settings/notificationActions", () => ({ listPushDevices, removePushSubscription }));
import { clearBrowserPush, clearUnownedBrowserPush } from "@/lib/browser-push";

const endpoint = "https://fcm.googleapis.com/fcm/send/token";
const unsubscribe = vi.fn();
const close = vi.fn();
const getSubscription = vi.fn();
const getNotifications = vi.fn();
const getRegistration = vi.fn();
beforeEach(() => {
  unsubscribe.mockReset().mockResolvedValue(true);
  getSubscription.mockReset().mockResolvedValue({ endpoint, unsubscribe });
  close.mockClear();
  getNotifications.mockReset().mockResolvedValue([{ close }]);
  getRegistration.mockReset().mockResolvedValue({ pushManager: { getSubscription }, getNotifications });
  removePushSubscription.mockReset().mockResolvedValue({ success: true });
  listPushDevices.mockReset().mockResolvedValue([]);
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser push cleanup", () => {
  it("revokes the current server subscription, unsubscribes locally, and closes visible notifications", async () => {
    await clearBrowserPush();
    expect(removePushSubscription).toHaveBeenCalledWith(endpoint);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("still unsubscribes and closes notifications when the server refuses cleanup", async () => {
    removePushSubscription.mockResolvedValue({ error: "database unavailable" });
    await clearBrowserPush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });
  it("still revokes on the server when local unsubscribe rejects", async () => {
    unsubscribe.mockRejectedValue(new Error("browser unavailable"));
    await clearBrowserPush();
    expect(removePushSubscription).toHaveBeenCalledWith(endpoint);
    expect(close).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });
  it("reports a browser refusing to unsubscribe", async () => {
    unsubscribe.mockResolvedValue(false);
    await clearBrowserPush();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: "Browser refused to unsubscribe" }));
  });
  it("still attempts local cleanup when the server request rejects", async () => {
    removePushSubscription.mockRejectedValue(new Error("offline"));
    await clearBrowserPush();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it("closes notifications even without a live subscription", async () => {
    getSubscription.mockResolvedValue(null);
    await clearBrowserPush();
    expect(removePushSubscription).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("does nothing without a worker registration", async () => {
    getRegistration.mockResolvedValue(undefined);
    await clearBrowserPush();
    await clearUnownedBrowserPush();
    expect(removePushSubscription).not.toHaveBeenCalled();
  });
  it("does nothing in a browser without service workers", async () => {
    vi.stubGlobal("navigator", {});
    await clearBrowserPush();
    await clearUnownedBrowserPush();
    expect(getRegistration).not.toHaveBeenCalled();
  });
  it("keeps a subscription owned by the current member", async () => {
    listPushDevices.mockResolvedValue([{ isThisDevice: true }]);
    await clearUnownedBrowserPush();
    expect(listPushDevices).toHaveBeenCalledWith(endpoint);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("preserves a subscription when its ownership cannot be checked", async () => {
    listPushDevices.mockRejectedValue(new Error("database unavailable"));
    await expect(clearUnownedBrowserPush()).rejects.toThrow("database unavailable");
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(removePushSubscription).not.toHaveBeenCalled();
  });
  it("supports a worker on a browser without the Push API or notification listing", async () => {
    getRegistration.mockResolvedValue({});
    await clearBrowserPush();
    await clearUnownedBrowserPush();
    expect(removePushSubscription).not.toHaveBeenCalled();
  });
  it("stops delivery from a previous account without enrolling the current member", async () => {
    await clearUnownedBrowserPush();
    expect(unsubscribe).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});

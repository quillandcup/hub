// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const listPushDevices = vi.hoisted(() => vi.fn());
const pausePushSubscription = vi.hoisted(() => vi.fn());
const resumePushSubscription = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/settings/notificationActions", () => ({ listPushDevices, pausePushSubscription, resumePushSubscription }));
import { pauseBrowserPush, syncBrowserPush, rememberBrowserPush, forgetBrowserPush } from "@/lib/browser-push";

const endpoint = "https://fcm.googleapis.com/fcm/send/token";
const unsubscribe = vi.fn();
const close = vi.fn();
const getSubscription = vi.fn();
const getNotifications = vi.fn();
const getRegistration = vi.fn();
const subscribe = vi.fn();
const subscription = { endpoint, unsubscribe, toJSON: () => ({ endpoint, keys: { p256dh: "key", auth: "auth" } }) };
beforeEach(() => {
  localStorage.clear();
  unsubscribe.mockReset().mockResolvedValue(true);
  getSubscription.mockReset().mockResolvedValue(subscription);
  subscribe.mockReset().mockResolvedValue(subscription);
  close.mockClear();
  getNotifications.mockReset().mockResolvedValue([{ close }]);
  getRegistration.mockReset().mockResolvedValue({ pushManager: { getSubscription, subscribe }, getNotifications });
  pausePushSubscription.mockReset().mockResolvedValue({ success: true, memberId: "m1" });
  resumePushSubscription.mockReset().mockResolvedValue({ success: true });
  listPushDevices.mockReset().mockResolvedValue([]);
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser push across sign-out and sign-in", () => {
  it("pauses delivery, remembers consent and closes notifications; then restores the same account without a prompt", async () => {
    await pauseBrowserPush();
    expect(pausePushSubscription).toHaveBeenCalledWith(endpoint);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    getSubscription.mockResolvedValue(null);
    await syncBrowserPush("m1", "AAAA");
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: "AAAA" });
    expect(resumePushSubscription).toHaveBeenCalledWith(endpoint, subscription.toJSON());
  });
  it("does not enroll a different account", async () => {
    await pauseBrowserPush();
    getSubscription.mockResolvedValue(null);
    await syncBrowserPush("m2", "AAAA");
    expect(subscribe).not.toHaveBeenCalled();
    expect(resumePushSubscription).not.toHaveBeenCalled();
  });
  it("can resume both accounts after each has explicitly opted in", async () => {
    rememberBrowserPush("m1", endpoint);
    rememberBrowserPush("m2", "https://web.push.apple.com/other");
    getSubscription.mockResolvedValue(null);
    await syncBrowserPush("m1", "AAAA");
    await syncBrowserPush("m2", "AAAA");
    expect(resumePushSubscription.mock.calls.map((c) => c[0])).toEqual([endpoint, "https://web.push.apple.com/other"]);
  });
  it("preserves remembered consent even when server pause fails, but still stops local delivery", async () => {
    rememberBrowserPush("m1", endpoint);
    pausePushSubscription.mockResolvedValue({ error: "database unavailable" });
    await expect(pauseBrowserPush()).rejects.toThrow("database unavailable");
    expect(unsubscribe).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    getSubscription.mockResolvedValue(null);
    await syncBrowserPush("m1", "AAAA");
    expect(resumePushSubscription).toHaveBeenCalled();
  });
  it("still pauses on the server when local unsubscribe rejects", async () => {
    unsubscribe.mockRejectedValue(new Error("browser unavailable"));
    await pauseBrowserPush();
    expect(pausePushSubscription).toHaveBeenCalledWith(endpoint);
    expect(close).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it("reports a browser refusing to unsubscribe", async () => {
    unsubscribe.mockResolvedValue(false);
    await pauseBrowserPush();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: "Browser refused to unsubscribe" }));
  });
  it("still attempts local cleanup when the server request rejects", async () => {
    pausePushSubscription.mockRejectedValue(new Error("offline"));
    await expect(pauseBrowserPush()).rejects.toThrow("offline");
    expect(unsubscribe).toHaveBeenCalled();
  });
  it("closes notifications even without a live subscription", async () => {
    getSubscription.mockResolvedValue(null);
    await pauseBrowserPush();
    expect(pausePushSubscription).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("does nothing without a worker registration", async () => {
    getRegistration.mockResolvedValue(undefined);
    await pauseBrowserPush();
    await syncBrowserPush("m1", "AAAA");
    expect(pausePushSubscription).not.toHaveBeenCalled();
  });
  it("does nothing in a browser without service workers", async () => {
    vi.stubGlobal("navigator", {});
    await pauseBrowserPush();
    await syncBrowserPush("m1", "AAAA");
    expect(getRegistration).not.toHaveBeenCalled();
  });
  it("keeps and remembers an active subscription owned by the current member", async () => {
    listPushDevices.mockResolvedValue([{ isThisDevice: true }]);
    await syncBrowserPush("m1", "AAAA");
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("hub.browserPush.m1")).toBe(endpoint);
  });
  it("preserves a subscription when ownership cannot be checked", async () => {
    listPushDevices.mockRejectedValue(new Error("database unavailable"));
    await expect(syncBrowserPush("m1", "AAAA")).rejects.toThrow("database unavailable");
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("supports a worker without the Push API or notification listing", async () => {
    getRegistration.mockResolvedValue({});
    await pauseBrowserPush();
    await syncBrowserPush("m1", "AAAA");
    expect(pausePushSubscription).not.toHaveBeenCalled();
  });
  it("stops another account's local delivery without enrolling the current member", async () => {
    await syncBrowserPush("m2", "AAAA");
    expect(unsubscribe).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(resumePushSubscription).not.toHaveBeenCalled();
  });
  it("does not prompt or subscribe after permission was revoked", async () => {
    rememberBrowserPush("m1", endpoint);
    getSubscription.mockResolvedValue(null);
    vi.stubGlobal("Notification", { permission: "denied" });
    await syncBrowserPush("m1", "AAAA");
    expect(subscribe).not.toHaveBeenCalled();
  });
  it("does not resume without configured keys", async () => {
    rememberBrowserPush("m1", endpoint);
    getSubscription.mockResolvedValue(null);
    await syncBrowserPush("m1", null);
    expect(subscribe).not.toHaveBeenCalled();
  });
  it("resumes an owned paused subscription without creating another", async () => {
    rememberBrowserPush("m1", endpoint);
    listPushDevices.mockResolvedValue([{ isThisDevice: true, paused: true }]);
    await syncBrowserPush("m1", "AAAA");
    expect(subscribe).not.toHaveBeenCalled();
    expect(resumePushSubscription).toHaveBeenCalled();
  });
  it("unsubscribes if the server refuses to revive a remotely removed device", async () => {
    rememberBrowserPush("m1", endpoint);
    getSubscription.mockResolvedValue(null);
    resumePushSubscription.mockResolvedValue({ error: "This device needs a new opt-in" });
    await expect(syncBrowserPush("m1", "AAAA")).rejects.toThrow("new opt-in");
    expect(unsubscribe).toHaveBeenCalled();
  });
  it("serializes repeated sign-in effects so they don't unsubscribe a subscription another effect just resumed", async () => {
    rememberBrowserPush("m1", endpoint);
    let active = false;
    getSubscription.mockImplementation(async () => active ? subscription : null);
    listPushDevices.mockImplementation(async () => active ? [{ isThisDevice: true }] : []);
    subscribe.mockImplementation(async () => { active = true; return subscription; });
    await Promise.all([syncBrowserPush("m1", "AAAA"), syncBrowserPush("m1", "AAAA")]);
    expect(resumePushSubscription).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("does not change a device for an account guard that was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await syncBrowserPush("m1", "AAAA", controller.signal);
    expect(getRegistration).not.toHaveBeenCalled();
  });
  it("does not change the device after switching accounts during an ownership lookup", async () => {
    const controller = new AbortController();
    listPushDevices.mockImplementation(async () => { controller.abort(); return []; });
    await syncBrowserPush("m1", "AAAA", controller.signal);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(resumePushSubscription).not.toHaveBeenCalled();
  });
  it("forgets an explicit opt-out without losing another account's consent", async () => {
    rememberBrowserPush("m1", endpoint);
    rememberBrowserPush("m2", "https://web.push.apple.com/other");
    localStorage.setItem("unrelated", endpoint);
    forgetBrowserPush(endpoint);
    getSubscription.mockResolvedValue(null);
    await syncBrowserPush("m1", "AAAA");
    expect(subscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("hub.browserPush.m2")).toBe("https://web.push.apple.com/other");
    expect(localStorage.getItem("unrelated")).toBe(endpoint);
  });
});

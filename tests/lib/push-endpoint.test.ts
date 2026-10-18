import { describe, it, expect } from "vitest";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";

describe("push endpoint destinations", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://another.push.apple.com/token",
    "https://wns2-region.notify.windows.com/w/?token=abc",
    "https://FCM.GOOGLEAPIS.COM:443/fcm/send/token",
  ])("accepts a supported provider: %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    undefined, null, {}, "", "not a url", "https://" + "x".repeat(2048),
    "http://fcm.googleapis.com/push", "https://localhost/push", "https://127.0.0.1/push",
    "https://[::1]/push", "https://169.254.169.254/push", "https://example.com/push",
    "https://fcm.googleapis.com.evil.test/push", "https://evilpush.apple.com/push",
    "https://push.apple.com/push", "https://evilnotify.windows.com/push",
    "https://updates.push.services.mozilla.com.evil.test/push",
    "https://fcm.googleapis.com:8443/push", "https://fcm.googleapis.com/push#fragment",
    "https://user@fcm.googleapis.com/push", "https://:pass@fcm.googleapis.com/push",
    "https://fcm.googleapis.com@evil.test/push", "ftp://web.push.apple.com/push",
  ])("rejects arbitrary or ambiguous destinations: %j", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

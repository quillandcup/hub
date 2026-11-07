import { describe, it, expect } from "vitest";
import { describeSessionDevice, describeDevice, userAgentForStorage, MAX_USER_AGENT_LENGTH } from "@/lib/device-label";

describe("userAgentForStorage", () => {
  it("keeps a normal user agent as is", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
    expect(userAgentForStorage(ua)).toBe(ua);
  });

  it("caps an oversized header", () => {
    expect(userAgentForStorage("x".repeat(MAX_USER_AGENT_LENGTH + 100))).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it.each([null, undefined, "", "   "])("stores %j as null", (ua) => {
    expect(userAgentForStorage(ua)).toBeNull();
  });
});

describe("describeDevice", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile Safari/604.1", "Chrome on iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Safari/604.1", "Safari on iPad"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0", "Edge on Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Chrome on Mac"],
    ["Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0", "Firefox on Android"],
    [null, "Unknown device"],
  ])("labels %s", (ua, label) => {
    expect(describeDevice(ua)).toBe(label);
  });
});

describe("describeSessionDevice", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36", "Chrome 156 on macOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15", "Safari 18 on macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.7 Mobile/15E148 Safari/604.1", "Safari on iPhone (iOS 18.7)"],
    ["Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0.1 Mobile/15E148 Safari/604.1", "Chrome 126 on iPad (iOS 17.4)"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0.2592.81", "Edge 126 on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0", "Firefox 126 on Windows"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome 126 on Android 14"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36", "Chrome 126 on ChromeOS"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0", "Firefox 126 on Linux"],
    [null, "Unknown device"],
    ["curl/8.0", "Unknown device"],
  ])("labels %s", (ua, label) => {
    expect(describeSessionDevice(ua)).toBe(label);
  });
});

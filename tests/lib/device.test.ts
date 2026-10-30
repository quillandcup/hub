import { describe, it, expect } from "vitest";
import { parseDevice, deviceForStorage } from "@/lib/device";
import { deviceLabel, describeStoredDevice } from "@/lib/device-label";

const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  safariIpad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("parseDevice", () => {
  it("reads the browser, system and kind of device", () => {
    expect(parseDevice(UA.chromeMac)).toEqual({ browser: "Chrome", browser_version: "126.0.0.0", os: "macOS", os_version: null, device_type: "desktop" });
    expect(parseDevice(UA.firefoxWindows)).toEqual({ browser: "Firefox", browser_version: "127.0", os: "Windows", os_version: null, device_type: "desktop" });
    expect(parseDevice(UA.edgeWindows)?.browser).toBe("Edge");
    expect(parseDevice(UA.chromeAndroid)).toMatchObject({ browser: "Chrome", os: "Android", device_type: "phone" });
    expect(parseDevice(UA.firefoxLinux)).toMatchObject({ browser: "Firefox", os: "Linux", device_type: "desktop" });
  });

  it("keeps the OS version only for iOS, where it is real; macOS and Windows report a frozen one", () => {
    expect(parseDevice(UA.safariIphone)).toEqual({ browser: "Safari", browser_version: "17.5", os: "iOS", os_version: "17.5", device_type: "phone" });
    expect(parseDevice(UA.safariIpad)).toMatchObject({ os: "iOS", os_version: "17.5", device_type: "tablet" });
    // Chrome on iOS is WebKit underneath, so the system is what matters.
    expect(parseDevice(UA.chromeIphone)).toMatchObject({ browser: "Chrome", os: "iOS", os_version: "17.5" });
    for (const ua of [UA.chromeMac, UA.safariMac, UA.firefoxWindows, UA.chromeAndroid]) expect(parseDevice(ua)?.os_version).toBeNull();
  });

  it("gives nothing for a missing, blank or unreadable string", () => {
    expect(parseDevice(null)).toBeNull();
    expect(parseDevice(undefined)).toBeNull();
    expect(parseDevice("   ")).toBeNull();
    expect(parseDevice("curl/8.1")).toBeNull();
  });

  it("treats a crawler as another kind of device", () => {
    expect(parseDevice("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toMatchObject({ browser: "Googlebot", device_type: "other" });
  });

  it("is the same on every call, including from the cache, and bounds field lengths", () => {
    expect(parseDevice(UA.chromeMac)).toEqual(parseDevice(UA.chromeMac));
    expect(parseDevice(UA.chromeMac)).not.toBe(null);
    const long = `Mozilla/5.0 (X11; Linux x86_64) ${"Chrome/".concat("1".repeat(200))}`;
    const parsed = parseDevice(long);
    for (const value of Object.values(parsed ?? {})) expect(String(value ?? "").length).toBeLessThanOrEqual(40);
  });

  it("evicts old strings so the cache stays bounded", () => {
    for (let i = 0; i < 300; i++) parseDevice(`Mozilla/5.0 (X11; Linux x86_64; rv:${i}.0) Gecko/20100101 Firefox/${i}.0`);
    expect(parseDevice(`Mozilla/5.0 (X11; Linux x86_64; rv:299.0) Gecko/20100101 Firefox/299.0`)?.browser_version).toBe("299.0");
    expect(parseDevice(`Mozilla/5.0 (X11; Linux x86_64; rv:0.0) Gecko/20100101 Firefox/0.0`)?.browser_version).toBe("0.0");
  });
});

describe("deviceForStorage", () => {
  it("is the parsed device for a jsonb column, or null when there is nothing to read", () => {
    expect(deviceForStorage(UA.safariIphone)).toEqual({ browser: "Safari", browser_version: "17.5", os: "iOS", os_version: "17.5", device_type: "phone" });
    expect(deviceForStorage(null)).toBeNull();
    expect(deviceForStorage("curl/8.1")).toBeNull();
  });
});

describe("deviceLabel", () => {
  it("names the device the way a member would", () => {
    expect(deviceLabel(parseDevice(UA.chromeMac))).toBe("Chrome on Mac");
    expect(deviceLabel(parseDevice(UA.safariIphone))).toBe("Safari on iPhone");
    expect(deviceLabel(parseDevice(UA.safariIpad))).toBe("Safari on iPad");
    expect(deviceLabel(parseDevice(UA.firefoxLinux))).toBe("Firefox on Linux");
    expect(deviceLabel(parseDevice(UA.edgeWindows))).toBe("Edge on Windows");
  });

  it("copes with half a device, and with none", () => {
    expect(deviceLabel({ browser: "Chrome", os: null })).toBe("Chrome");
    expect(deviceLabel({ browser: null, os: "Windows" })).toBe("Windows");
    expect(deviceLabel({})).toBeNull();
    expect(deviceLabel(null)).toBeNull();
  });
});

describe("describeStoredDevice", () => {
  it("prefers the stored device, which outlives the user-agent string, then the string, then says unknown", () => {
    expect(describeStoredDevice({ browser: "Safari", os: "iOS", device_type: "phone" }, null)).toBe("Safari on iPhone");
    expect(describeStoredDevice(null, UA.chromeMac)).toBe("Chrome on Mac");
    expect(describeStoredDevice(null, null)).toBe("Unknown device");
  });
});

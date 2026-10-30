import Bowser from "bowser";
import type { DeviceInfo } from "@/lib/device-label";
import { asJson } from "@/lib/data/json";
import type { Json } from "@/lib/data/database.types";

/**
 * Parses a user-agent string with Bowser into the `DeviceInfo` shape described in lib/device-label.ts. Server-only:
 * the parser is not small, and the labels a client needs (`deviceLabel`, `describeStoredDevice`) live in
 * lib/device-label.ts without it.
 */
const MAX_FIELD_LENGTH = 40;
const clip = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD_LENGTH) : null;
};

const DEVICE_TYPES: Record<string, DeviceInfo["device_type"]> = { desktop: "desktop", mobile: "phone", tablet: "tablet" };

// The same few strings arrive on every request from one browser, and the proxy parses on each of them.
const CACHE_LIMIT = 200;
const cache = new Map<string, DeviceInfo | null>();

/** The device behind a user-agent string, or null when there is no string or nothing in it can be read. */
export function parseDevice(userAgent: string | null | undefined): DeviceInfo | null {
  const ua = userAgent?.trim();
  if (!ua) return null;
  if (cache.has(ua)) return cache.get(ua) ?? null;

  let result: DeviceInfo | null = null;
  try {
    const parsed = Bowser.parse(ua);
    const browser = clip(parsed.browser.name === "Microsoft Edge" ? "Edge" : parsed.browser.name);
    const os = clip(parsed.os.name);
    if (browser || os) {
      result = {
        browser,
        browser_version: browser ? clip(parsed.browser.version) : null,
        os,
        os_version: os === "iOS" ? clip(parsed.os.version) : null,
        device_type: DEVICE_TYPES[parsed.platform.type ?? ""] ?? "other",
      };
    }
  } catch {
    result = null;
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(ua, result);
  return result;
}

/** The device ready for a `device` jsonb column: the parsed object, or null when there is nothing to read. */
export function deviceForStorage(userAgent: string | null | undefined): Json | null {
  const device = parseDevice(userAgent);
  return device ? asJson(device) : null;
}

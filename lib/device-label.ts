/** Longest user agent we store. Real ones run ~150-300 characters; the header is client-controlled. */
export const MAX_USER_AGENT_LENGTH = 512;

/** A request's user agent ready to store: trimmed, capped at MAX_USER_AGENT_LENGTH, null when absent. */
export function userAgentForStorage(userAgent: string | null | undefined): string | null {
  const trimmed = userAgent?.trim();
  return trimmed ? trimmed.slice(0, MAX_USER_AGENT_LENGTH) : null;
}

/** A short, human label for a browser's user agent, e.g. "Chrome on iPhone". Client-safe. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(userAgent)
            ? "Mac"
            : /Linux|CrOS/.test(userAgent)
              ? "Linux"
              : null;
  // Order matters: Edge and Chrome on iOS also say Safari, Edge also says Chrome.
  const browser = /EdgiOS|Edg\//.test(userAgent)
    ? "Edge"
    : /FxiOS|Firefox/.test(userAgent)
      ? "Firefox"
      : /CriOS|Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  if (browser && device) return `${browser} on ${device}`;
  return browser ?? device ?? "Unknown device";
}

/**
 * What we keep of a browser's user-agent string once the string itself is gone (it is removed after
 * `RETENTION.rawNetworkDays`, see lib/retention.ts): the browser and operating system, with versions
 * where the string honestly carries them, and the kind of device. Parsed once, when a request is
 * recorded, by a maintained parser (Bowser), never by hand-written patterns.
 *
 * Versions are only as good as the string. Browsers deliberately freeze parts of it: macOS reports 10.15.7
 * whatever the real version, Windows 11 reports Windows 10, and Chrome reports a reduced Android version and
 * "x.0.0.0" minor versions. So `os_version` is kept only for iOS, which reports its real version, and is null
 * everywhere else rather than a misleading frozen value. `device_type` from a user agent alone can't tell an
 * iPad that asks for desktop sites from a Mac; a signal from the browser itself (touch) would, and is a
 * later phase (docs/EVENT_LOG.md, "Device and viewport").
 */
export interface DeviceInfo {
  /** "Chrome", "Safari", "Firefox", "Edge"... */
  browser: string | null;
  /** As the string reports it, e.g. "126.0.0.0" or "17.5". */
  browser_version: string | null;
  /** "macOS", "iOS", "Windows", "Android", "Linux"... */
  os: string | null;
  /** Only for iOS; null where browsers freeze or reduce it. */
  os_version: string | null;
  device_type: "desktop" | "phone" | "tablet" | "other" | null;
}

/** The device name a member would recognise: "Chrome on Mac", "Safari on iPhone". Null when nothing is known. */
export function deviceLabel(device: Partial<DeviceInfo> | null | undefined): string | null {
  if (!device) return null;
  const where =
    device.os === "iOS"
      ? device.device_type === "tablet"
        ? "iPad"
        : "iPhone"
      : device.os === "macOS"
        ? "Mac"
        : device.os === "Linux" || device.os === "Chrome OS"
          ? "Linux"
          : (device.os ?? null);
  if (device.browser && where) return `${device.browser} on ${where}`;
  return device.browser ?? where ?? null;
}

/**
 * The label for a row that may have either: the stored device when there is one (it outlives the user-agent
 * string), else the string, else "Unknown device".
 */
export function describeStoredDevice(device: Partial<DeviceInfo> | null | undefined, userAgent: string | null | undefined): string {
  return deviceLabel(device) ?? (userAgent ? describeDevice(userAgent) : "Unknown device");
}

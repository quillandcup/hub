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

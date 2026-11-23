import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the SSRF row of docs/trust/THREAT_MODEL.md (A10): any server-side request to an address a member, a message or an
 * import chose must go through `src/lib/net/safe-fetch.ts` (docs/infrastructure/OUTBOUND_REQUESTS.md). This lists every server file in
 * `src/app/`, `src/lib/` and `src/modules/` that makes an HTTP request of its own and makes each one say why it is safe: either the address is
 * fixed (a provider's host, our own project, an operator's environment variable), or the file goes through safe-fetch.
 * A new caller fails here until it is classified; a caller that goes away leaves a stale entry that also fails.
 */
const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = ["src/app", "src/lib", "src/modules"]
  .flatMap((dir) => sourceFiles(path.join(root, dir)))
  .map((file) => ({ file: path.relative(root, file), source: fs.readFileSync(file, "utf8") }))
  .filter(({ file }) => file !== "src/lib/net/safe-fetch.ts") // the guard itself
  // A client component's request runs in the member's own browser, not on our server.
  .filter(({ source }) => !/^\s*["']use client["']/m.test(source.slice(0, 400)));

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A request made by the file itself: fetch, our wrapper, an injected fetch, a fetch used as a default, or node's http(s). */
const REQUEST = /(?<![.\w])(?:fetch|outboundFetch|fetchImpl)\(|=\s*fetch\b|\bhttps?\.(?:request|get)\(|from ["'](?:undici|node-fetch|axios|got)["']/;

/** Files whose requests are all to a safe-fetch guarded address. */
const THROUGH_SAFE_FETCH = [
  "src/lib/chat/link-previews.ts",
  "src/lib/chat/unfurl-image-cache.ts",
  "src/lib/landing/kajabi-import-service.ts",
  "src/lib/media/fetch-cover.ts",
  "src/lib/members/adopt-photos.ts",
];

/** Files that call `fetch` themselves, each with why the address is not user-chosen. Only ever shrinks. */
const FIXED_HOST: Record<string, string> = {
  "src/lib/http/outbound.ts": "the User-Agent wrapper; callers pass fixed hosts (see the entries below)",
  "src/lib/analytics/client.ts": "browser code posting to our own tracking route (no 'use client' marker, runs in the browser)",
  "src/app/api/health/route.ts": "our own Supabase project's URL from configuration",
  "src/app/(admin)/admin/courses/lesson-video-actions.ts": "Mux's image host with a playback id from our own table",
  "src/lib/cron-heartbeats.ts": "a heartbeat URL the operator sets in an environment variable, never from the database or a member",
  "src/lib/email.ts": "the Resend API",
  "src/lib/email-events-pull.ts": "the Resend API (list endpoint with our cursor)",
  "src/lib/google-photos-picker/client.ts": "Google's OAuth and Picker hosts; the media base URL comes from Google's own picker response",
  "src/lib/kajabi/client.ts": "the Kajabi API base from configuration",
  "src/lib/zoom/client.ts": "the Zoom API base from configuration",
  "src/lib/landing/ai.ts": "the Anthropic API URL from configuration; the member's text is the body, never the address",
  "src/lib/trackbear-cover.ts": "a fixed TrackBear origin; the file name is matched against a strict pattern before it is used in the path",
  "src/lib/courses/media.ts": "a signed download URL Kajabi's API returned for a course video (staff import), not typed by a member",
  "src/lib/prospecting/sources/bluesky.ts": "the public Bluesky API host, queries go in the parameters",
  "src/modules/chat/slack/avatar-copy.ts": "Slack profile photo URLs from Slack's own API payload (default fetch; a test passes a stub), never typed by a member",
  "src/lib/chat/emoji-copy.ts": "Slack custom emoji URLs from Slack's own API payload (default fetch; a test passes a stub)",
  "src/lib/courses/files.ts": "Kajabi file links from the staff-run course import (default fetch; a test passes a stub)",
  "src/lib/courses/images.ts": "Kajabi image links from the staff-run course import (default fetch; a test passes a stub)",
  "src/lib/slack-capture.ts": "Slack file URLs (url_private) from a signed webhook or Slack's own API, fetched with the bot token (default fetch; a test passes a stub)",
  "src/lib/prospecting/sources/run.ts": "hands the platform fetch to a source that talks to its one fixed host",
};

describe("server requests to user-chosen addresses go through safe-fetch", () => {
  const callers = files.filter(({ source }) => REQUEST.test(code(source))).map((f) => f.file);

  it("scans the source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("every file that makes a request is classified", () => {
    const classified = new Set(Object.keys(FIXED_HOST));
    const unclassified = callers.filter((file) => !classified.has(file));
    expect(
      unclassified,
      "A new server-side request. If the address is chosen by a member, a message or an import, use fetchImage, fetchPage or safeGet from src/lib/net/safe-fetch.ts. If it is a fixed provider host, add the file to FIXED_HOST with the reason.",
    ).toEqual([]);
  });

  it("every FIXED_HOST entry still makes a request", () => {
    for (const file of Object.keys(FIXED_HOST)) {
      expect(callers.includes(file), `${file} no longer makes a request of its own: remove it from FIXED_HOST`).toBe(true);
    }
  });

  it("a file does not use safe-fetch and a bare request at once", () => {
    const mixed = files.filter(({ file, source }) => file !== "src/lib/net/safe-fetch.ts" && /@\/lib\/net\/safe-fetch/.test(source) && REQUEST.test(code(source))).map((f) => f.file);
    expect(mixed, "a file that downloads user-chosen addresses must not also make bare requests").toEqual([]);
  });

  it("the safe-fetch callers still import it", () => {
    for (const file of THROUGH_SAFE_FETCH) {
      const found = fs.readFileSync(path.join(root, file), "utf8");
      expect(/@\/lib\/net\/safe-fetch/.test(found), `${file} no longer reaches safe-fetch`).toBe(true);
    }
  });

  it("the chat picture proxy route stays on the guarded cache", () => {
    const route = fs.readFileSync(path.join(root, "src/app/api/chat/unfurl-image/route.ts"), "utf8");
    expect(route).toContain("safe-fetch");
  });
});

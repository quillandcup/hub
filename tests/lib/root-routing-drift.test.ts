import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUB_ONLY_SEGMENTS, INFRASTRUCTURE_SEGMENTS, ROOT_SERVED_SEGMENTS } from "@/lib/root-routing";

/**
 * On the public site's root host, a top-level path nobody has named is sent to Kajabi (src/lib/root-routing.ts). So a new page
 * must be named in one of its three lists, or it would silently turn into a redirect there. This test fails until it is:
 *   - ROOT_SERVED_SEGMENTS: a public page the root host serves itself,
 *   - HUB_ONLY_SEGMENTS: a signed-in page, which the root host sends to the app host,
 *   - INFRASTRUCTURE_SEGMENTS: not a page (a file, an API, a platform path).
 */
const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "src/app");

/** Files in src/app that are page conventions or metadata files, not paths. */
const CONVENTION_FILES = /^(layout|page|error|global-error|not-found|loading|template|default)\.(tsx|ts)$|^globals\.css$/;
/** Metadata files that Next serves as a top-level path: file name to the path it answers. */
const METADATA_PATHS: Record<string, string> = {
  "robots.ts": "robots.txt",
  "manifest.ts": "manifest.webmanifest",
  "sitemap.ts": "sitemap.xml",
};
/** Image metadata files (icon, opengraph-image) answer at an image path that the proxy's matcher skips entirely. */
const IMAGE_METADATA = /^(icon|opengraph-image|twitter-image|apple-icon)\.(png|jpe?g|svg|ico)$/;

/** Whether a folder holds anything Next serves (a page, a route handler, a sitemap), as opposed to helpers such as src/app/actions. */
function hasRoute(dir: string): boolean {
  return readdirSync(dir).some((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? hasRoute(full) : /^(page|route)\.(tsx|ts)$|^(sitemap|robots|manifest)\.ts$/.test(name);
  });
}

/** The top-level paths src/app defines, looking through route groups `(name)` and skipping private folders `_name`. */
function appSegments(dir = APP): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("_")) continue;
      if (/^\(.+\)$/.test(name)) found.push(...appSegments(full));
      else if (hasRoute(full)) found.push(name);
    } else if (dir === APP || /^\(.+\)$/.test(path.basename(dir))) {
      if (CONVENTION_FILES.test(name) || IMAGE_METADATA.test(name)) continue;
      found.push(METADATA_PATHS[name] ?? `FILE:${name}`);
    }
  }
  return found;
}

const NAMED = [...ROOT_SERVED_SEGMENTS, ...HUB_ONLY_SEGMENTS, ...INFRASTRUCTURE_SEGMENTS];

describe("root host routing lists", () => {
  it("name every top-level path in src/app", () => {
    const unnamed = appSegments().filter((segment) => !NAMED.includes(segment));
    expect(unnamed, "name these in ROOT_SERVED_SEGMENTS, HUB_ONLY_SEGMENTS or INFRASTRUCTURE_SEGMENTS (src/lib/root-routing.ts)").toEqual([]);
  });

  it("has no top-level dynamic segment (it would answer every old Kajabi address)", () => {
    expect(appSegments().filter((s) => s.startsWith("[") || s.startsWith("@"))).toEqual([]);
  });

  it("names no route that src/app has dropped, in the two lists made of pages", () => {
    const real = new Set(appSegments());
    expect([...ROOT_SERVED_SEGMENTS, ...HUB_ONLY_SEGMENTS].filter((s) => !real.has(s))).toEqual([]);
  });

  it("names each path once", () => {
    expect(NAMED.filter((s, i) => NAMED.indexOf(s) !== i)).toEqual([]);
  });

  it("accounts for the files in public/ that the proxy's matcher does not already skip", () => {
    const skipped = /\.(svg|png|jpg|jpeg|gif|webp)$/;
    const unnamed = readdirSync(path.join(ROOT, "public")).filter((name) => {
      if (name.startsWith(".")) return false;
      if (statSync(path.join(ROOT, "public", name)).isDirectory()) return false;
      return !skipped.test(name) && !NAMED.includes(name);
    });
    expect(unnamed, "add these to INFRASTRUCTURE_SEGMENTS, or they redirect to Kajabi on the root host").toEqual([]);
  });

  it("keeps the public/ folders to images (the proxy skips those, so a folder's name needs no entry)", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(path.join(ROOT, "public"))) {
      const dir = path.join(ROOT, "public", name);
      if (!statSync(dir).isDirectory()) continue;
      const walk = (d: string) => {
        for (const entry of readdirSync(d)) {
          const full = path.join(d, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (!/\.(svg|png|jpg|jpeg|gif|webp)$/.test(entry)) offenders.push(path.relative(ROOT, full));
        }
      };
      walk(dir);
    }
    expect(offenders).toEqual([]);
  });
});

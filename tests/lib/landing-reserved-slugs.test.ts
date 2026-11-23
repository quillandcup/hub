import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUB_ONLY_SEGMENTS, INFRASTRUCTURE_SEGMENTS, ROOT_SERVED_SEGMENTS } from "@/lib/root-routing";
import { RESERVED_SLUGS, SLUG_PATTERN, isValidSlug } from "@/lib/landing/slug";

/**
 * A published landing page is served at /<slug> on the root host (src/lib/root-routing.ts), so a slug that is also a real
 * top-level path would shadow it (or be shadowed, and never be reachable). RESERVED_SLUGS must therefore name every top-level
 * path that src/app, public/ and the root host's lists serve or own, at least those a slug can spell (lowercase words and dashes:
 * "robots.txt" and "_next" are not addresses a page can have). This fails until a new top-level path is added to RESERVED_SLUGS
 * (src/lib/landing/slug.ts), like tests/lib/root-routing-drift.test.ts does for the root host's own lists.
 */
const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "src/app");

/** Whether a folder holds anything Next serves (a page, a route handler, a sitemap), as opposed to helpers such as src/app/actions. */
function hasRoute(dir: string): boolean {
  return readdirSync(dir).some((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? hasRoute(full) : /^(page|route)\.(tsx|ts)$|^(sitemap|robots|manifest)\.ts$/.test(name);
  });
}

/** The top-level folders of src/app, looking through route groups `(name)`, that hold a route (a page or a handler) or a metadata route. */
function appFolders(dir = APP): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory() || name.startsWith("_")) continue;
    if (/^\(.+\)$/.test(name)) found.push(...appFolders(full));
    else if (hasRoute(full)) found.push(name);
  }
  return found;
}

/** Top-level files and folders of public/, minus the extension of a file (`/changelog/x.png` is under `changelog`). */
const publicNames = () => readdirSync(path.join(ROOT, "public")).filter((n) => !n.startsWith("."));

const spellable = (segment: string) => SLUG_PATTERN.test(segment);

describe("reserved landing page addresses", () => {
  it("name every top-level folder of src/app that a slug could spell", () => {
    const missing = appFolders().filter((s) => spellable(s) && !RESERVED_SLUGS.includes(s));
    expect(missing, "add these to RESERVED_SLUGS (src/lib/landing/slug.ts)").toEqual([]);
  });

  it("name every segment the root host serves, sends to the app host or leaves to the platform, that a slug could spell", () => {
    const named = [...ROOT_SERVED_SEGMENTS, ...HUB_ONLY_SEGMENTS, ...INFRASTRUCTURE_SEGMENTS];
    const missing = named.filter((s) => spellable(s) && !RESERVED_SLUGS.includes(s));
    expect(missing, "add these to RESERVED_SLUGS (src/lib/landing/slug.ts)").toEqual([]);
  });

  it("name every folder in public/ that a slug could spell", () => {
    const missing = publicNames()
      .filter((n) => statSync(path.join(ROOT, "public", n)).isDirectory())
      .filter((n) => spellable(n) && !RESERVED_SLUGS.includes(n));
    expect(missing).toEqual([]);
  });

  it("are all valid-looking addresses that isValidSlug turns down (no stale entry), once each", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(SLUG_PATTERN.test(slug), slug).toBe(true);
      expect(isValidSlug(slug), slug).toBe(false);
    }
    expect(RESERVED_SLUGS.filter((s, i) => RESERVED_SLUGS.indexOf(s) !== i)).toEqual([]);
  });

  it("leave the page `home` and ordinary words free", () => {
    for (const slug of ["home", "free-trial", "spring-challenge", "ada-example"]) expect(isValidSlug(slug), slug).toBe(true);
  });
});

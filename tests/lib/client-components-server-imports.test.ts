import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * A "use client" file is bundled for the browser, so a value import (not `import type`) of a module that pulls in the
 * server-side repositories takes the page down with a client-side exception at runtime, which a build and the
 * component tests (which run in Node) don't notice. This is how the past events page broke.
 */
const SERVER_ONLY_MODULES = ["@/lib/event-prickles", "@/lib/data/repos", "@/lib/data/server", "@/lib/supabase/server", "@/lib/supabase/service"];

const ROOT = path.resolve(__dirname, "../..");

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe("client components", () => {
  it("do not import server-side modules as values", () => {
    const offenders: string[] = [];
    for (const file of [...sources("app"), ...sources("components")]) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (!/^\s*["']use client["']/.test(text)) continue;
      for (const [, imported] of text.matchAll(/^import\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gm)) {
        if (SERVER_ONLY_MODULES.includes(imported)) offenders.push(`${file} imports ${imported}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches the import that broke the past events page", () => {
    const text = 'import { withoutFollowedEvents, type EventPrickle } from "@/lib/event-prickles";\nimport type { Db } from "@/lib/data/repos";';
    const found = [...text.matchAll(/^import\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(found).toEqual(["@/lib/event-prickles"]);
  });
});
